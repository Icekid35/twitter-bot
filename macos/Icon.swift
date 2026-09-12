import AppKit
let size = 1024
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()
let rect = NSRect(x: 64, y: 64, width: 896, height: 896)
let shape = NSBezierPath(roundedRect: rect, xRadius: 205, yRadius: 205)
NSGradient(starting: NSColor(calibratedRed: 0.20, green: 0.40, blue: 0.98, alpha: 1), ending: NSColor(calibratedRed: 0.05, green: 0.18, blue: 0.66, alpha: 1))!.draw(in: shape, angle: -65)
let line = NSBezierPath(); line.lineWidth = 70; line.lineCapStyle = .round; line.lineJoinStyle = .round
line.move(to: NSPoint(x: 230, y: 460)); line.line(to: NSPoint(x: 360, y: 460)); line.line(to: NSPoint(x: 450, y: 670)); line.line(to: NSPoint(x: 570, y: 330)); line.line(to: NSPoint(x: 660, y: 560)); line.line(to: NSPoint(x: 794, y: 560)); NSColor.white.setStroke(); line.stroke()
image.unlockFocus()
let bitmap = NSBitmapImageRep(data: image.tiffRepresentation!)!
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
