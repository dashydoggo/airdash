#!/usr/bin/env python3
import argparse
import codecs
import hashlib
import json
import os
import shutil
import struct
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from PIL import Image

KTX2_MAGIC = b"\xabKTX 20\xbb\r\n\x1a\n"
DDS_MAGIC = b"DDS "
VK_FORMAT_BC7_SRGB_BLOCK = 145
DXGI_FORMAT_BC7_UNORM = 98
BUILD_TIME = datetime(2026, 9, 10, tzinfo=timezone.utc).timestamp()
FILETIME_EPOCH_OFFSET = 11_644_473_600


def filetime(timestamp: float = BUILD_TIME) -> int:
    return int((timestamp + FILETIME_EPOCH_OFFSET) * 10_000_000)


def build_dds_header(width: int, height: int, levels: int, first_level_size: int) -> bytes:
    flags = 0x1 | 0x2 | 0x4 | 0x1000 | 0x20000 | 0x80000
    caps = 0x1000 | (0x8 | 0x400000 if levels > 1 else 0)
    header = struct.pack(
        "<I6I11I",
        124,
        flags,
        height,
        width,
        first_level_size,
        0,
        levels,
        *([0] * 11),
    )
    pixel_format = struct.pack("<II4s5I", 32, 0x4, b"DX10", 0, 0, 0, 0, 0)
    caps_block = struct.pack("<5I", caps, 0, 0, 0, 0)
    dx10 = struct.pack("<5I", DXGI_FORMAT_BC7_UNORM, 3, 0, 1, 0)
    result = DDS_MAGIC + header + pixel_format + caps_block + dx10
    if len(result) != 148:
        raise ValueError(f"DDS header length is {len(result)}, expected 148")
    return result


def ktx2_to_dds(data: bytes) -> bytes:
    if not data.startswith(KTX2_MAGIC) or len(data) < 80:
        raise ValueError("Texture is not KTX2")
    vk_format, _type_size, width, height, _depth, _layers, _faces, levels, scheme = struct.unpack_from("<9I", data, 12)
    if vk_format != VK_FORMAT_BC7_SRGB_BLOCK:
        raise ValueError(f"Unsupported KTX2 vkFormat {vk_format}")
    if scheme != 0:
        raise ValueError(f"Unsupported KTX2 supercompression scheme {scheme}")
    if not width or not height or not levels:
        raise ValueError("Invalid KTX2 dimensions or level count")
    mipmaps = []
    offset = 80
    for _ in range(levels):
        byte_offset, byte_length, uncompressed_length = struct.unpack_from("<QQQ", data, offset)
        offset += 24
        if byte_length != uncompressed_length or byte_offset + byte_length > len(data):
            raise ValueError("Invalid or compressed KTX2 level")
        mipmaps.append(data[byte_offset:byte_offset + byte_length])
    return build_dds_header(width, height, levels, len(mipmaps[0])) + b"".join(mipmaps)


def aircraft_cfg(registration: str, livery_name: str | None) -> bytes:
    display = f"airDash Airbus A220-300 {registration}"
    variation = f"airDash {registration}" + (f" · {livery_name}" if livery_name else "")
    text = f'''[VERSION]
major =1
minor =0

[VARIATION]
base_container ="..\\inibuilds_aircraft-a220"

[FLTSIM.0]
Title = "{display}"
Model = "ATC"
Panel = ""
Sound = ""
Texture = "{registration}"
KB_Checklists = ""
KB_Reference = ""
description = "airDash virtual airline livery"
wip_indicator = 0
ui_manufacturer = "Airbus"
ui_type = "A220-300"
ui_variation = "{variation}"
ui_typerole = "Airliners"
ui_createdby = "airDash"
ui_thumbnailfile = ""
ui_certified_ceiling = -1
ui_max_range = -1
ui_autonomy = -1
ui_fuel_burn_rate = -1
atc_id = "{registration}"
icao_airline = "AIR"
atc_id_enable = 1
atc_airline = "AIR DASH"
atc_flight_number = ""
atc_heavy = 0
atc_id_color = "0x00000000"
atc_id_font = ""
isAirTraffic = 0
isUserSelectable = 1
isFlyable = 1
canBeUsedByAITraffic = 1
Effects = ""
atc_parking_types = "GATE"
atc_parking_codes = "AIR"
'''.replace("\n", "\r\n")
    return codecs.BOM_UTF8 + text.encode("utf-8")


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def set_build_time(root: Path) -> None:
    for path in sorted(root.rglob("*"), reverse=True):
        os.utime(path, (BUILD_TIME, BUILD_TIME), follow_symlinks=False)
    os.utime(root, (BUILD_TIME, BUILD_TIME), follow_symlinks=False)


def write_layout(package_root: Path) -> None:
    content = []
    for path in sorted(package_root.rglob("*")):
        if not path.is_file() or path.name.lower() in {"layout.json", "manifest.json"}:
            continue
        content.append({
            "path": path.relative_to(package_root).as_posix(),
            "size": path.stat().st_size,
            "date": filetime(path.stat().st_mtime),
        })
    write_json(package_root / "layout.json", {"content": content})
    os.utime(package_root / "layout.json", (BUILD_TIME, BUILD_TIME))


def zip_reproducible(package_root: Path, output_zip: Path) -> None:
    timestamp = time.gmtime(BUILD_TIME)[:6]
    output_zip.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(output_zip, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(package_root.rglob("*")):
            if not path.is_file():
                continue
            relative = Path(package_root.name) / path.relative_to(package_root)
            info = ZipInfo(relative.as_posix(), timestamp)
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)


def find_member(names: list[str], suffix: str) -> str:
    matches = [name for name in names if name.lower().endswith(suffix.lower())]
    if len(matches) != 1:
        raise ValueError(f"Expected one {suffix}, found {len(matches)}")
    return matches[0]


def build_one(source_zip: Path, metadata: dict, template_root: Path, output_dir: Path) -> dict:
    registration = metadata["registration"].upper()
    slug = registration.lower()
    package_name = f"synaptic-a220-livery-air-{registration}-msfs2020"
    aircraft_name = f"synaptic-a220-airliner-air_{slug}"
    texture_name = f"texture.{registration}"
    output_zip = output_dir / f"{package_name}.zip"

    with tempfile.TemporaryDirectory(prefix=f"airdash-{slug}-2020-") as temporary:
        package_root = Path(temporary) / package_name
        aircraft_root = package_root / "SimObjects" / "Airplanes" / aircraft_name
        model_root = aircraft_root / "model.ATC"
        texture_root = aircraft_root / texture_name
        model_root.mkdir(parents=True)
        texture_root.mkdir(parents=True)

        source_model = template_root / "model.ATC"
        for name in ["exterior.bin", "exterior.gltf", "Exterior.xml", "model.CFG"]:
            shutil.copyfile(source_model / name, model_root / name)
        shutil.copyfile(template_root / "TEXTURE.CFG", texture_root / "TEXTURE.CFG")
        (aircraft_root / "aircraft.cfg").write_bytes(aircraft_cfg(registration, metadata.get("liveryName")))

        with ZipFile(source_zip) as source:
            names = source.namelist()
            texture_members = sorted(name for name in names if name.upper().endswith(".KTX2"))
            if len(texture_members) != 10:
                raise ValueError(f"{registration}: expected 10 KTX2 textures, found {len(texture_members)}")
            for member in texture_members:
                basename = Path(member).name
                output_name = basename[:-5] + ".DDS"
                dds = ktx2_to_dds(source.read(member))
                (texture_root / output_name).write_bytes(dds)
                companion = member + ".json"
                if companion not in names:
                    raise ValueError(f"{registration}: companion metadata missing for {basename}")
                (texture_root / f"{output_name}.JSON").write_bytes(source.read(companion))

            thumbnail_member = find_member(names, "/thumbnail/thumbnail.png")
            with source.open(thumbnail_member) as raw_thumbnail:
                image = Image.open(raw_thumbnail).convert("RGB")
                image.save(texture_root / "thumbnail.jpg", "JPEG", quality=92, optimize=True)
                image.save(texture_root / "thumbnail_small.jpg", "JPEG", quality=88, optimize=True)

        manifest = {
            "dependencies": [],
            "content_type": "LIVERY",
            "title": f"airDash Airbus A220-300 {registration}",
            "manufacturer": "Airbus",
            "creator": "airDash",
            "package_version": metadata.get("version", "1.0.0"),
            "minimum_game_version": "1.24.5",
            "release_notes": {"neutral": {"LastUpdate": "", "OlderHistory": ""}},
        }
        write_json(package_root / "manifest.json", manifest)
        set_build_time(package_root)
        write_layout(package_root)
        zip_reproducible(package_root, output_zip)

    digest = hashlib.sha256(output_zip.read_bytes()).hexdigest()
    return {
        "registration": registration,
        "simulator": "Microsoft Flight Simulator 2020",
        "file": output_zip.name,
        "downloadUrl": f"/downloads/liveries/{slug}/{output_zip.name}",
        "sha256": digest,
        "fileSizeBytes": output_zip.stat().st_size,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Synaptic A220 airDash MSFS 2020 liveries")
    parser.add_argument("--liveries-root", type=Path, required=True)
    parser.add_argument("--template-root", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--registration", action="append", default=[])
    args = parser.parse_args()

    registrations = {value.upper() for value in args.registration}
    results = []
    for metadata_path in sorted(args.liveries_root.glob("*/manifest.json")):
        metadata = json.loads(metadata_path.read_text())
        registration = metadata["registration"].upper()
        if registrations and registration not in registrations:
            continue
        source_zip = metadata_path.parent / metadata["file"]
        if not source_zip.is_file():
            raise FileNotFoundError(source_zip)
        output_dir = args.output_root / registration.lower()
        result = build_one(source_zip, metadata, args.template_root, output_dir)
        results.append(result)
        print(f"{registration}: {result['fileSizeBytes']} bytes {result['sha256']}")

    if not results:
        raise SystemExit("No liveries selected")
    write_json(args.output_root / "catalog-msfs2020.json", {
        "aircraftType": "BCS3",
        "simulator": "Microsoft Flight Simulator 2020",
        "count": len(results),
        "packages": results,
    })


if __name__ == "__main__":
    main()
