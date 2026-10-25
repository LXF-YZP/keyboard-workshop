import AppKit
import Vision
import UniformTypeIdentifiers
import CoreText

enum ImageAnalyzer {
    enum Source {
        case file(URL)
        case data(Data)
    }

    static func clipboardSource(_ pasteboard: NSPasteboard) throws -> Source? {
        let options: [NSPasteboard.ReadingOptionKey: Any] = [
            .urlReadingFileURLsOnly: true,
            .urlReadingContentsConformToTypes: [UTType.image.identifier]
        ]
        if let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: options) as? [URL], let url = urls.first {
            return .file(url)
        }
        let imageTypes = [NSPasteboard.PasteboardType.png, .tiff] + (pasteboard.types ?? []).filter {
            UTType($0.rawValue)?.conforms(to: .image) == true
        }
        if let type = pasteboard.availableType(from: imageTypes) {
            guard let data = pasteboard.data(forType: type), !data.isEmpty else {
                throw problem("无法读取剪贴板图片，请重新复制截图。")
            }
            guard data.count <= 30 * 1024 * 1024 else { throw problem("图片超过 30 MB，请先缩小后导入。") }
            return .data(data)
        }
        return nil
    }

    static func load(_ source: Source) throws -> (CGImage, Data) {
        switch source {
        case .file(let url): return try load(url)
        case .data(let data): return try load(data)
        }
    }

    static func load(_ url: URL) throws -> (CGImage, Data) {
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 30 * 1024 * 1024 else { throw problem("图片超过 30 MB，请先缩小后导入。") }
        return try load(Data(contentsOf: url))
    }

    static func load(_ data: Data) throws -> (CGImage, Data) {
        guard data.count <= 30 * 1024 * 1024 else { throw problem("图片超过 30 MB，请先缩小后导入。") }
        guard let image = NSImage(data: data), image.size.width > 0, image.size.height > 0,
              let original = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            throw problem("无法读取图片，请选择 PNG、JPEG 或 HEIC 图片。")
        }
        let ratio = min(1, 2000.0 / Double(max(original.width, original.height)))
        let width = max(1, Int(Double(original.width) * ratio)), height = max(1, Int(Double(original.height) * ratio))
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
            bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw problem("图片处理失败。")
        }
        context.setFillColor(NSColor.white.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.draw(original, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let scaled = context.makeImage(), let data = NSBitmapImageRep(cgImage: scaled).representation(using: .png, properties: [:]) else {
            throw problem("图片转换失败。")
        }
        return (scaled, data)
    }

    static func analyze(_ image: CGImage) throws -> [String: Any] {
        let rectangles = VNDetectRectanglesRequest()
        rectangles.maximumObservations = 256
        rectangles.minimumConfidence = 0.35
        rectangles.minimumAspectRatio = 0.3
        rectangles.maximumAspectRatio = 1.0
        rectangles.minimumSize = 0.018
        rectangles.quadratureTolerance = 25
        let text = VNRecognizeTextRequest()
        text.recognitionLevel = .accurate
        text.recognitionLanguages = ["en-US"]
        text.usesLanguageCorrection = false
        try VNImageRequestHandler(cgImage: image).perform([rectangles, text])
        let w = Double(image.width), h = Double(image.height)
        func point(_ p: CGPoint) -> [Double] { [Double(p.x) * w, (1 - Double(p.y)) * h] }
        let boxes: [[String: Any]] = (rectangles.results ?? []).map { r in
            ["points": [point(r.topLeft), point(r.topRight), point(r.bottomRight), point(r.bottomLeft)], "confidence": Double(r.confidence)]
        }
        let words: [[String: Any]] = (text.results ?? []).compactMap { r in
            guard let candidate = r.topCandidates(1).first else { return nil }
            return ["label": candidate.string, "x": Double(r.boundingBox.midX) * w,
                    "y": (1 - Double(r.boundingBox.midY)) * h, "confidence": Double(candidate.confidence)]
        }
        return ["rectangles": boxes, "words": words, "width": image.width, "height": image.height]
    }

    // Keycap legends are too small and rotated for the full-image pass, so each detected key is
    // straightened and read on its own. Revision 2 reads lone glyphs best but drops some at any one
    // scale, and an icon can get a confident read from a single crop: crops of several scales vote,
    // and a label needs agreeing reads, which leaves icon keycaps unlabeled. `extent` scales the
    // detected keycap box before cropping.
    struct LabelPass { let side: CGFloat; let extent: Double }
    static let labelPasses = [LabelPass(side: 96, extent: 0.65), LabelPass(side: 192, extent: 1.25), LabelPass(side: 128, extent: 1.25),
                              LabelPass(side: 192, extent: 1), LabelPass(side: 160, extent: 0.65)]
    static let labelVocabulary = ["Esc", "Tab", "Caps", "Caps Lock", "Shift", "Ctrl", "Control", "Alt", "AltGr", "Opt", "Option",
        "Cmd", "Command", "Win", "GUI", "Super", "Meta", "Hyper", "Fn", "Space", "Enter", "Ent", "Return", "Bksp", "Bspc",
        "Backspace", "Back", "Del", "Delete", "Ins", "Insert", "Home", "End", "PgUp", "PgDn", "Page Up", "Page Down", "PrtSc",
        "Print", "Scroll Lock", "ScrLk", "Pause", "Break", "Num Lock", "NumLk", "Menu", "App", "Raise", "Lower", "Layer",
        "Adjust", "Mute", "Up", "Down", "Left", "Right"] + (1...24).map { "F\($0)" }
    static let confusableGlyphs: [Set<String>] = [["O", "0", "D", "Q"], ["I", "1", "L", "T"], ["S", "5"], ["Z", "2"], ["B", "8"]]

    static func readLabels(_ image: CGImage, regions: [[String: Any]], progress: ((Int) -> Void)? = nil) -> [[String: Any]] {
        var labels = [[String: Any]?](repeating: nil, count: regions.count), done = 0
        let lock = NSLock()
        DispatchQueue.concurrentPerform(iterations: regions.count) { i in
            let label = (regions[i]["id"] as? String).flatMap { id in readLabel(image, region: regions[i]).map { ["id": id, "label": $0.text, "confidence": $0.score] as [String: Any] } }
            lock.lock(); labels[i] = label; done += 1; let count = done; lock.unlock()
            progress?(count)
        }
        return labels.compactMap { $0 }
    }

    static func readLabel(_ image: CGImage, region: [String: Any]) -> (text: String, score: Double)? {
        let values = ["x", "y", "w", "h", "angle"].compactMap { (region[$0] as? NSNumber)?.doubleValue }.filter(\.isFinite)
        guard values.count == 5, values[2] >= 4, values[3] >= 4, values[2] <= Double(image.width), values[3] <= Double(image.height) else { return nil }
        var votes: [(text: String, score: Double)] = []
        for pass in labelPasses {
            guard let crop = keyCrop(image, x: values[0], y: values[1], w: values[2] * pass.extent, h: values[3] * pass.extent, angle: values[4], side: pass.side) else { continue }
            let lines = readLines(crop)
            if let lowest = lines.map(\.score).min() { votes.append((lines.map(\.text).joined(separator: "\n"), lowest)) }
            if let best = bestVote(votes), best.score >= 1.3 { return best }
        }
        // Icon and blur misreads seen so far are lone glyphs or fragments such as "Cort", never a full key name;
        // other words also need one clearer read.
        if let best = bestVote(votes) {
            let known = labelVocabulary.contains(best.text), clearest = votes.filter { $0.text == best.text }.map(\.score).max() ?? 0
            if best.score >= 1.1 && (best.text.count == 1 || known || clearest >= 0.5) || known && best.text.count >= 4 && clearest >= 0.99 { return best }
        }
        return readSmallLegend(image, values: values)
    }

    // Vision treats punctuation and isolated letters as noise. Extract the ink, compare its shape
    // with local font outlines, and require agreement across contrast thresholds. No layout lookup
    // is used: a non-QWERTY keyboard must retain its actual legends.
    struct LegendInk {
        let pixels: [UInt8]
        let width: Int, height: Int, x: Int, y: Int, canvasWidth: Int, canvasHeight: Int, components: Int
        var ratio: Double { Double(width) / Double(height) }
    }
    struct GlyphTemplate { let text: String; let pixels: [UInt8]; let ratio: Double }
    static let glyphTemplates: [GlyphTemplate] = {
        var result = [GlyphTemplate]()
        let glyphs = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789;:',./!|\\-_=+[]()<>?").map(String.init)
        for name in ["Verdana-Bold", "Verdana", "Arial-BoldMT", "ArialMT", "ArialNarrow-Bold", "Menlo-Bold", "Helvetica-Bold"] {
            let font = CTFontCreateWithName(name as CFString, 72, nil)
            for text in glyphs {
                guard let context = CGContext(data: nil, width: 160, height: 160, bitsPerComponent: 8, bytesPerRow: 160,
                    space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { continue }
                context.setFillColor(gray: 0, alpha: 1); context.fill(CGRect(x: 0, y: 0, width: 160, height: 160))
                context.translateBy(x: 12, y: 24)
                let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [
                    NSAttributedString.Key(kCTFontAttributeName as String): font,
                    NSAttributedString.Key(kCTForegroundColorAttributeName as String): NSColor.white.cgColor
                ]))
                CTLineDraw(line, context)
                guard let image = context.makeImage(), let ink = legendInk(image, threshold: 0.5, template: true) else { continue }
                result.append(GlyphTemplate(text: text, pixels: normalizedInk(ink), ratio: ink.ratio))
            }
        }
        return result
    }()

    static func legendInk(_ image: CGImage, threshold: Double, template: Bool = false) -> LegendInk? {
        let w = image.width, h = image.height
        guard let context = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
        context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        guard let data = context.data?.assumingMemoryBound(to: UInt8.self) else { return nil }
        let gray = Array(UnsafeBufferPointer(start: data, count: w * h)), sorted = gray.sorted()
        let background = Double(sorted[sorted.count / 2])
        let bright = Double(sorted[Int(Double(sorted.count - 1) * 0.995)]) - background
        let dark = background - Double(sorted[Int(Double(sorted.count - 1) * 0.005)])
        let whiteInk = template || bright >= dark, contrast = whiteInk ? bright : dark
        guard contrast >= 30 else { return nil }
        var mask = gray.map { UInt8((whiteInk ? Double($0) - background : background - Double($0)) > contrast * threshold ? 1 : 0) }
        var groups = [[Int]](), visited = [Bool](repeating: false, count: w * h)
        for seed in 0..<mask.count where mask[seed] != 0 && !visited[seed] {
            var group = [seed], at = 0, touchesEdge = false; visited[seed] = true
            while at < group.count {
                let p = group[at], x = p % w, y = p / w; at += 1
                if x < 3 || y < 3 || x >= w - 3 || y >= h - 3 { touchesEdge = true }
                for dy in -1...1 { for dx in -1...1 {
                    let nx = x + dx, ny = y + dy
                    if nx >= 0 && ny >= 0 && nx < w && ny < h {
                        let n = ny * w + nx
                        if mask[n] != 0 && !visited[n] { visited[n] = true; group.append(n) }
                    }
                } }
            }
            if !touchesEdge && group.count >= 6 { groups.append(group) }
        }
        let largest = groups.map(\.count).max() ?? 0
        groups = groups.filter { $0.count >= max(6, largest / 35) }
        let points = groups.flatMap { $0 }
        guard !points.isEmpty, points.count < w * h / 3 else { return nil }
        let xs = points.map { $0 % w }, ys = points.map { $0 / w }
        let x = xs.min()!, y = ys.min()!, width = xs.max()! - x + 1, height = ys.max()! - y + 1
        guard template || (width < w * 9 / 10 && height < h * 4 / 5 && abs(Double(x + width / 2) / Double(w) - 0.5) < 0.25) else { return nil }
        mask = [UInt8](repeating: 0, count: width * height)
        for p in points { mask[(p / w - y) * width + p % w - x] = 1 }
        return LegendInk(pixels: mask, width: width, height: height, x: x, y: y, canvasWidth: w, canvasHeight: h, components: groups.count)
    }

    static func normalizedInk(_ ink: LegendInk) -> [UInt8] {
        (0..<1536).map { i in ink.pixels[min(ink.height - 1, (i / 32) * ink.height / 48) * ink.width + min(ink.width - 1, (i % 32) * ink.width / 32)] }
    }

    static func glyphScores(_ ink: LegendInk) -> [(text: String, score: Double)] {
        let observed = normalizedInk(ink), relativeHeight = Double(ink.height) / Double(ink.canvasHeight)
        var scores = [String: Double]()
        for template in glyphTemplates {
            let text = template.text
            // Dot, comma and apostrophe differ in their size and placement, which normalization loses.
            if text == "." && (relativeHeight > 0.15 || ink.ratio < 0.7 || ink.components != 1) { continue }
            if ["'", ","].contains(text) && (relativeHeight > 0.20 || ink.ratio > 0.85 || ink.components != 1) { continue }
            // Keycap text often sits below the face center; allow the apostrophe around the
            // center while a comma still needs a visibly lower baseline.
            if text == "'" && Double(ink.y + ink.height / 2) / Double(ink.canvasHeight) >= 0.55 { continue }
            if text == "," && Double(ink.y + ink.height / 2) / Double(ink.canvasHeight) < 0.55 { continue }
            if ![".", "'", ",", "-", "_", "="].contains(text) && relativeHeight < 0.20 { continue }
            if [";", ":"].contains(text) && ink.components != 2 { continue }
            // Normalizing a filled icon makes it look like a dash unless its original proportions
            // and connected strokes are checked first.
            if ["-", "_"].contains(text) && (ink.ratio < 2.5 || relativeHeight > 0.16 || ink.components != 1) { continue }
            if text == "=" && (ink.ratio < 1.4 || relativeHeight > 0.35 || ink.components != 2) { continue }
            if text.first!.isLetter || text.first!.isNumber { if ink.ratio > 1.5 { continue } }
            var intersection = 0, union = 0
            for i in observed.indices { if observed[i] != 0 || template.pixels[i] != 0 { union += 1 }; if observed[i] != 0 && template.pixels[i] != 0 { intersection += 1 } }
            let score = Double(intersection) / Double(max(1, union)) - 0.20 * abs(log(template.ratio / ink.ratio))
            scores[text] = max(scores[text] ?? 0, score)
        }
        return scores.map { (text: $0.key, score: $0.value) }.sorted { $0.score > $1.score }
    }

    static func repeatedInk(_ ink: LegendInk, height: Int) -> CGImage? {
        let glyphWidth = max(1, ink.width * height / ink.height), gap = height / 2
        let w = (glyphWidth + gap) * 3 + gap, h = height * 2
        var pixels = [UInt8](repeating: 255, count: w * h)
        for copy in 0..<3 { for y in 0..<height { for x in 0..<glyphWidth {
            if ink.pixels[y * ink.height / height * ink.width + x * ink.width / glyphWidth] != 0 {
                pixels[(y + gap) * w + gap + copy * (glyphWidth + gap) + x] = 0
            }
        } } }
        guard let provider = CGDataProvider(data: Data(pixels) as CFData) else { return nil }
        return CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: w,
            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue), provider: provider,
            decode: nil, shouldInterpolate: true, intent: .defaultIntent)
    }

    static func readSmallLegend(_ image: CGImage, values: [Double]) -> (text: String, score: Double)? {
        guard let crop = keyCrop(image, x: values[0], y: values[1], w: values[2] * 0.65, h: values[3] * 0.65, angle: values[4], side: 160) else { return nil }
        let inks = [0.50, 0.65].compactMap { legendInk(crop, threshold: $0) }
        let ranks = inks.map(glyphScores)
        if ranks.count == 2, let a = ranks[0].first, let b = ranks[1].first, a.text == b.text,
           min(a.score, b.score) >= 0.68, ranks.allSatisfy({ $0.count < 2 || $0[0].score - $0[1].score >= 0.045 }) {
            return (a.text, min(a.score, b.score))
        }
        // Extra thresholds recover faint strokes and blurred punctuation, but must confirm
        // both normal thresholds and still provide two strong, unambiguous shape matches.
        let extraRanks = [0.40, 0.60].compactMap { legendInk(crop, threshold: $0) }.map(glyphScores)
        if extraRanks.count == 2 {
            let confirmed = ranks + extraRanks
            if confirmed.count == 4, let best = confirmed[0].first,
               confirmed.allSatisfy({ $0.first?.text == best.text && $0[0].score >= 0.60 && ($0.count < 2 || $0[0].score - $0[1].score >= 0.03) }),
               confirmed.filter({ $0[0].score >= 0.68 && ($0.count < 2 || $0[0].score - $0[1].score >= 0.08) }).count >= 2 {
                return (best.text, confirmed.map { $0[0].score }.min()!)
            }
        }
        // Repeating the same glyph gives Vision a text line; shape evidence still has to agree.
        var repeated = [String: Int]()
        for ink in inks where ink.ratio < 1.5 {
            guard let sheet = repeatedInk(ink, height: 64) else { continue }
            for line in readLines(sheet) {
                let compact = line.text.replacingOccurrences(of: " ", with: "").uppercased()
                if compact.count == 3, let first = compact.first, compact.allSatisfy({ $0 == first }), first.isLetter || first.isNumber {
                    repeated[String(first), default: 0] += 1
                }
            }
        }
        for (text, count) in repeated where count >= 2 {
            if ranks.allSatisfy({ ($0.first(where: { $0.text == text })?.score ?? 0) >= 0.52 }) { return (text, 0.7) }
        }
        if inks.contains(where: { $0.ratio >= 1.3 }) {
            var names = [String: Int]()
            // Include the smaller full-face crop: tiny resampling differences can otherwise
            // leave a blurred key name readable in only one of the original five passes.
            for pass in labelPasses + [LabelPass(side: 96, extent: 1)] {
                guard let wordCrop = keyCrop(image, x: values[0], y: values[1], w: values[2] * pass.extent, h: values[3] * pass.extent, angle: values[4], side: pass.side) else { continue }
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate; request.recognitionLanguages = ["en-US"]
                request.usesLanguageCorrection = true; request.customWords = labelVocabulary; request.revision = VNRecognizeTextRequestRevision2
                guard (try? VNImageRequestHandler(cgImage: wordCrop).perform([request])) != nil else { continue }
                let candidates = Set((request.results ?? []).flatMap { $0.topCandidates(3) }.compactMap { candidate -> String? in
                    let raw = candidate.string.trimmingCharacters(in: CharacterSet(charactersIn: ".,:;' "))
                    guard let text = cleanLabel(raw), text.count >= 3, labelVocabulary.contains(text) else { return nil }
                    return text
                })
                if candidates.count == 1, let text = candidates.first {
                    names[text, default: 0] += 1
                    if names[text]! >= 2 { return (text, 0.7) }
                }
            }
        }
        return nil
    }

    static func bestVote(_ votes: [(text: String, score: Double)]) -> (text: String, score: Double)? {
        func similarity(_ a: String, _ b: String) -> Double {
            if a == b { return 1 }
            if a.count == 1 && b.count == 1 { return confusableGlyphs.contains { $0.contains(a) && $0.contains(b) } ? 0.5 : 0 }
            return min(a.count, b.count) >= 2 && editDistance(a, b) == 1 ? 0.6 : 0
        }
        return votes.map { vote in (vote.text, votes.reduce(0) { $0 + $1.score * similarity(vote.text, $1.text) }) }
            .max { $0.1 < $1.1 || ($0.1 == $1.1 && $0.0 > $1.0) }
    }

    static func keyCrop(_ image: CGImage, x: Double, y: Double, w: Double, h: Double, angle: Double, side: CGFloat) -> CGImage? {
        let scale = side / CGFloat(max(w, h)), width = max(8, Int((CGFloat(w) * scale).rounded())), height = max(8, Int((CGFloat(h) * scale).rounded()))
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        // Map the rotated key onto an upright crop; CoreGraphics is y-up while the regions are y-down.
        context.interpolationQuality = .high
        context.translateBy(x: CGFloat(width) / 2, y: CGFloat(height) / 2)
        context.scaleBy(x: scale, y: scale)
        context.rotate(by: CGFloat(angle) * .pi / 180)
        context.translateBy(x: -CGFloat(x), y: CGFloat(y) - CGFloat(image.height))
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        return context.makeImage()
    }

    static func readLines(_ image: CGImage) -> [(text: String, score: Double)] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["en-US"]
        request.usesLanguageCorrection = false
        if VNRecognizeTextRequest.supportedRevisions.contains(VNRecognizeTextRequestRevision2) { request.revision = VNRecognizeTextRequestRevision2 }
        guard (try? VNImageRequestHandler(cgImage: image).perform([request])) != nil else { return [] }
        let lines = (request.results ?? []).sorted { $0.boundingBox.midY > $1.boundingBox.midY }.compactMap { observation -> (text: String, score: Double)? in
            guard let candidate = observation.topCandidates(1).first, let label = cleanLabel(candidate.string) else { return nil }
            return (label, Double(candidate.confidence))
        }
        return Array(lines.prefix(3))
    }

    static func cleanLabel(_ raw: String) -> String? {
        let text = raw.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard !text.isEmpty, text.count <= 12, text.unicodeScalars.allSatisfy({ (0x21..<0x7f).contains($0.value) || $0 == " " }) else { return nil }
        if text.count == 1, text.first!.isLetter { return text.uppercased() }
        if let word = labelVocabulary.first(where: { $0.caseInsensitiveCompare(text) == .orderedSame }) { return word }
        // Misreads such as "At", "GUT" or "Ralse" are one letter off a common key name; ambiguous ones stay as read.
        let close = text.count >= 2 ? labelVocabulary.filter { $0.count >= 3 && editDistance($0, text) == 1 } : []
        return close.count == 1 ? close[0] : text
    }

    static func editDistance(_ a: String, _ b: String) -> Int {
        let a = Array(a.lowercased()), b = Array(b.lowercased())
        guard !a.isEmpty, !b.isEmpty else { return max(a.count, b.count) }
        var row = Array(0...b.count)
        for i in 1...a.count {
            var diagonal = row[0]; row[0] = i
            for j in 1...b.count {
                let above = row[j]
                row[j] = min(above + 1, row[j - 1] + 1, diagonal + (a[i - 1] == b[j - 1] ? 0 : 1))
                diagonal = above
            }
        }
        return row[b.count]
    }

    static func problem(_ message: String) -> NSError {
        NSError(domain: "KeyboardWorkshop", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
