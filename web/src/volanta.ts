export const VOLANTA_DESKTOP_URI = "volanta://"

export function launchVolantaDesktop(documentRef: Document = document): void {
  const link = documentRef.createElement("a")
  link.href = VOLANTA_DESKTOP_URI
  link.style.display = "none"
  documentRef.body.appendChild(link)
  link.click()
  link.remove()
}
