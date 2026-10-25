import AppKit

// 真实图片、真实检测框和逐键人工标准答案；不打开应用、不接触用户工程。
@main enum NativeLegendSmoke {
    static func main() throws {
        let root = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : FileManager.default.currentDirectoryPath)
        let fixtures = root.appendingPathComponent("Tests/fixtures/legends")
        let cases = [
            ("模糊截图42键", fixtures.appendingPathComponent("blurred-42.png"), "blurred-42"),
            ("参考截图42键", root.appendingPathComponent("示例/参考键盘.png"), "reference-42"),
            ("模糊截图按当前键位补读", fixtures.appendingPathComponent("blurred-42.png"), "blurred-current-42"),
            ("参考截图按当前键位补读", root.appendingPathComponent("示例/参考键盘.png"), "reference-current-42"),
            ("连续导入与重新识别后的补读", root.appendingPathComponent("示例/参考键盘.png"), "reference-reloaded-41"),
            ("浅深键帽、旋转、数字与图标", fixtures.appendingPathComponent("symbols.png"), "symbols")
        ]
        var failures = [String]()
        for (name, url, truth) in cases {
            let (image, _) = try ImageAnalyzer.load(url)
            let regions = try JSONSerialization.jsonObject(with: Data(contentsOf: fixtures.appendingPathComponent("\(truth).json"))) as! [[String: Any]]
            let started = Date(), labels = ImageAnalyzer.readLabels(image, regions: regions)
            let byID = Dictionary(uniqueKeysWithValues: labels.map { ($0["id"] as! String, $0["label"] as! String) })
            let expectedIDs = Set(regions.map { $0["id"] as! String })
            if !Set(byID.keys).isSubset(of: expectedIDs) { failures.append("\(name)：返回未知键位") }
            for (i, region) in regions.enumerated() {
                let expected = region["expected"] as! String, actual = byID[region["id"] as! String] ?? ""
                if expected != actual { failures.append("\(name) 第\(i + 1)键：应为「\(expected)」，实际「\(actual)」") }
            }
            let words = regions.filter { !($0["expected"] as! String).isEmpty }.count
            print("\(name)：\(words)个文字键、\(regions.count - words)个图标键，\(String(format: "%.2f", Date().timeIntervalSince(started)))秒")
        }
        if !failures.isEmpty { print("FAIL:\n" + failures.joined(separator: "\n")); exit(1) }
        print("PASS: 两张截图首次识别与补读共209个文字键逐键一致，合成19个文字键全对、21个图标均不填字。")
    }
}
