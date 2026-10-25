import AppKit
// Synthetic keyboard: letters / words / digits mixed with icon-only keycaps (truth = "").
let items: [(String, Bool)] = [ // (text or symbol name, isIcon)
  ("Esc",false),("speaker.wave.2.fill",true),("globe",true),("1",false),("2",false),("Q",false),("W",false),("command",true),
  ("power",true),("A",false),("S",false),("sun.max.fill",true),("moon.fill",true),("Fn",false),("Caps",false),("magnifyingglass",true),
  ("mic.fill",true),("Z",false),("X",false),("playpause.fill",true),("F5",false),("house.fill",true),("wifi",true),("Del",false),
  ("applelogo",true),("lock.fill",true),("star.fill",true),("pawprint.fill",true),("Home",false),("camera.fill",true),("cloud.fill",true),("bolt.fill",true),
  ("gearshape.fill",true),("M",false),("heart.fill",true),("7",false),("Shift",false),("Alt",false),("arrow.up",true),("Enter",false)]
let cols = 8, pitch: CGFloat = 90, cap: CGFloat = 78
let rows = (items.count + cols - 1) / cols
let W = Int(CGFloat(cols) * pitch + 60), H = Int(CGFloat(rows) * pitch + 60)
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: W, pixelsHigh: H, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor(white: 0.55, alpha: 1).setFill(); NSRect(x: 0, y: 0, width: W, height: H).fill()
var regions: [[String: Any]] = []
for (i, item) in items.enumerated() {
  let col = i % cols, row = i / cols
  let cx = 30 + pitch * (CGFloat(col) + 0.5), cyTop = 30 + pitch * (CGFloat(row) + 0.5), cy = CGFloat(H) - cyTop
  let light = (i % 5 == 3)
  let angle: CGFloat = (i % 7 == 2) ? 12 : (i % 11 == 5 ? -18 : 0)
  let t = NSAffineTransform(); t.translateX(by: cx, yBy: cy); t.rotate(byDegrees: -angle)
  NSGraphicsContext.saveGraphicsState(); t.concat()
  (light ? NSColor(white: 0.9, alpha: 1) : NSColor(white: 0.2, alpha: 1)).setFill()
  NSBezierPath(roundedRect: NSRect(x: -cap/2, y: -cap/2, width: cap, height: cap), xRadius: 8, yRadius: 8).fill()
  let ink = light ? NSColor(white: 0.15, alpha: 1) : NSColor(white: 0.92, alpha: 1)
  if item.1 {
    let cfg = NSImage.SymbolConfiguration(pointSize: 18, weight: .regular)
    if let img = NSImage(systemSymbolName: item.0, accessibilityDescription: nil)?.withSymbolConfiguration(cfg) {
      let tinted = NSImage(size: img.size, flipped: false) { r in img.draw(in: r); ink.set(); r.fill(using: .sourceAtop); return true }
      tinted.draw(in: NSRect(x: -img.size.width/2, y: -img.size.height/2, width: img.size.width, height: img.size.height))
    }
  } else {
    let font = NSFont(name: i % 2 == 0 ? "Helvetica" : "Avenir Next", size: item.0.count > 2 ? 13 : 17)!
    let s = NSAttributedString(string: item.0, attributes: [.font: font, .foregroundColor: ink])
    s.draw(at: NSPoint(x: -s.size().width/2, y: -s.size().height/2))
  }
  NSGraphicsContext.restoreGraphicsState()
  regions.append(["id": "s\(i)", "x": Double(cx), "y": Double(cyTop), "w": Double(cap), "h": Double(cap), "angle": Double(angle), "truth": item.1 ? "" : item.0])
}
NSGraphicsContext.restoreGraphicsState()
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "synth.png"))
try JSONSerialization.data(withJSONObject: regions).write(to: URL(fileURLWithPath: "synth-truth.json"))
