import AppKit

let size = NSSize(width: 1024, height: 1024)
let image = NSImage(size: size)
image.lockFocus()

let background = NSBezierPath(roundedRect: NSRect(origin: .zero, size: size), xRadius: 230, yRadius: 230)
NSGradient(colors: [
    NSColor(calibratedRed: 0.045, green: 0.06, blue: 0.10, alpha: 1),
    NSColor(calibratedRed: 0.08, green: 0.10, blue: 0.18, alpha: 1),
])!.draw(in: background, angle: -45)

let glow = NSBezierPath(ovalIn: NSRect(x: 150, y: 170, width: 724, height: 724))
NSColor(calibratedRed: 0.30, green: 0.42, blue: 1, alpha: 0.12).setFill()
glow.fill()

let barRects = [
    NSRect(x: 265, y: 315, width: 112, height: 286),
    NSRect(x: 456, y: 245, width: 112, height: 470),
    NSRect(x: 647, y: 285, width: 112, height: 365),
]
let gradient = NSGradient(colors: [
    NSColor(calibratedRed: 0.48, green: 0.69, blue: 1, alpha: 1),
    NSColor(calibratedRed: 0.50, green: 0.34, blue: 1, alpha: 1),
])!
for rect in barRects {
    let path = NSBezierPath(roundedRect: rect, xRadius: 42, yRadius: 42)
    gradient.draw(in: path, angle: -90)
}

image.unlockFocus()
guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Unable to render icon")
}
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
