import Foundation

@main enum ExportTests {
    static func main() throws {
        let fm = FileManager.default, parent = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try fm.createDirectory(at: parent, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: parent) }
        let file = FirmwareExport.File(path: ".github/workflows/build.yml", content: "中文 UTF-8\n")
        for path in ["/tmp/x", "../x", "a/../x", "a//x", "a/", "./x", "a\\x", "a b", "", ".", ".."] {
            precondition(!FirmwareExport.validPath(path), path)
            do { _ = try FirmwareExport.write(parent: parent, name: "board", files: [.init(path: path, content: "x")]); fatalError("accepted \(path)") } catch {}
        }
        for name in ["..", "/tmp", "a/b", "a b", ""] { do { _ = try FirmwareExport.write(parent: parent, name: name, files: [file]); fatalError("accepted root") } catch {} }
        let first = try FirmwareExport.write(parent: parent, name: "board-qmk", files: [file])
        let second = try FirmwareExport.write(parent: parent, name: "board-qmk", files: [.init(path: "README.md", content: "second")])
        precondition(first.lastPathComponent == "board-qmk" && second.lastPathComponent == "board-qmk-2")
        let saved = try String(contentsOf: first.appendingPathComponent(file.path), encoding: .utf8)
        precondition(saved == file.content)
        precondition(!fm.fileExists(atPath: first.appendingPathComponent("README.md").path))
        for paths in [["a", "A"], ["a", "a/b"], ["a/b", "a"]] {
            do { try FirmwareExport.validate(name: "x", files: paths.map { .init(path: $0, content: "") }); fatalError("duplicate/conflict") } catch {}
        }
        print("PASS: path traversal, invalid roots, hidden directories, UTF-8, collision suffix, no overwrite, duplicate and prefix conflicts")
    }
}
