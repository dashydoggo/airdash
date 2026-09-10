export interface AirportInfo {
  name: string
  city: string
  country: string
  lat: number
  lon: number
}

export const AIRPORTS: Record<string, AirportInfo> = {
  KATL: { name: "Hartsfield-Jackson Atlanta International", city: "Atlanta", country: "United States", lat: 33.64, lon: -84.43 },
  KDEN: { name: "Denver International", city: "Denver", country: "United States", lat: 39.86, lon: -104.67 },
  KGEG: { name: "Spokane International", city: "Spokane", country: "United States", lat: 47.62, lon: -117.53 },
  KJFK: { name: "John F. Kennedy International", city: "New York", country: "United States", lat: 40.64, lon: -73.78 },
  KEWR: { name: "Newark Liberty International", city: "Newark", country: "United States", lat: 40.69, lon: -74.17 },
  KLGA: { name: "LaGuardia", city: "New York", country: "United States", lat: 40.78, lon: -73.87 },
  KBOS: { name: "Boston Logan International", city: "Boston", country: "United States", lat: 42.37, lon: -71.01 },
  KPVD: { name: "Rhode Island T. F. Green International", city: "Providence", country: "United States", lat: 41.73, lon: -71.42 },
  KPHL: { name: "Philadelphia International", city: "Philadelphia", country: "United States", lat: 39.87, lon: -75.24 },
  KIAD: { name: "Washington Dulles International", city: "Washington", country: "United States", lat: 38.95, lon: -77.46 },
  KBDL: { name: "Bradley International", city: "Hartford", country: "United States", lat: 41.94, lon: -72.68 },
  KMIA: { name: "Miami International", city: "Miami", country: "United States", lat: 25.8, lon: -80.29 },
  KFLL: { name: "Fort Lauderdale-Hollywood International", city: "Fort Lauderdale", country: "United States", lat: 26.07, lon: -80.15 },
  KMCO: { name: "Orlando International", city: "Orlando", country: "United States", lat: 28.43, lon: -81.31 },
  KTPA: { name: "Tampa International", city: "Tampa", country: "United States", lat: 27.98, lon: -82.53 },
  KLAX: { name: "Los Angeles International", city: "Los Angeles", country: "United States", lat: 33.94, lon: -118.41 },
  KSEA: { name: "Seattle-Tacoma International", city: "Seattle", country: "United States", lat: 47.45, lon: -122.31 },
  KDFW: { name: "Dallas Fort Worth International", city: "Dallas-Fort Worth", country: "United States", lat: 32.9, lon: -97.04 },
  KDTW: { name: "Detroit Metropolitan", city: "Detroit", country: "United States", lat: 42.21, lon: -83.35 },
  KSAN: { name: "San Diego International", city: "San Diego", country: "United States", lat: 32.73, lon: -117.19 },
  KPUB: { name: "Pueblo Memorial", city: "Pueblo", country: "United States", lat: 38.29, lon: -104.5 },
  MDSD: { name: "Las Americas International", city: "Santo Domingo", country: "Dominican Republic", lat: 18.43, lon: -69.67 },
  MDST: { name: "Cibao International", city: "Santiago", country: "Dominican Republic", lat: 19.41, lon: -70.6 },
  MDPC: { name: "Punta Cana International", city: "Punta Cana", country: "Dominican Republic", lat: 18.57, lon: -68.36 },
  MDPP: { name: "Gregorio Luperon International", city: "Puerto Plata", country: "Dominican Republic", lat: 19.76, lon: -70.57 },
  MDLR: { name: "La Romana International", city: "La Romana", country: "Dominican Republic", lat: 18.45, lon: -68.91 },
  MDCY: { name: "Samana El Catey International", city: "Samana", country: "Dominican Republic", lat: 19.27, lon: -69.74 },
  MDBH: { name: "Maria Montez International", city: "Barahona", country: "Dominican Republic", lat: 18.25, lon: -71.12 },
}

export const airportCoordinate = (code: string): [number, number] | null => {
  const airport = AIRPORTS[code]
  return airport ? [airport.lat, airport.lon] : null
}
