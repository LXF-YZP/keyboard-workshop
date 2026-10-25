import Foundation
import Darwin

// 只在用户选择的父目录中新建仓库，不覆盖任何已有目录或文件。
enum FirmwareExport {
    struct File { let path: String; let content: String }
    static func problem(_ message: String) -> NSError { NSError(domain: "KeyboardWorkshop.FirmwareExport", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    static func validPath(_ path: String) -> Bool {
        guard !path.isEmpty, path.range(of: "^[A-Za-z0-9._/-]+$", options: .regularExpression) != nil else { return false }
        return path.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }
    static func validate(name: String, files: [File]) throws {
        guard validPath(name), !name.contains("/"), name.count <= 100, !files.isEmpty, files.count <= 2000 else { throw problem("固件目录名或文件数量无效。") }
        var paths = Set<String>(), bytes = 0
        for file in files {
            guard validPath(file.path), file.path.count <= 240 else { throw problem("固件文件路径无效：" + file.path) }
            let path = file.path.lowercased()
            guard paths.insert(path).inserted else { throw problem("固件文件路径重复：" + file.path) }
            bytes += file.content.utf8.count
        }
        guard bytes <= 25 * 1024 * 1024 else { throw problem("固件工程超过 25 MB。") }
        for path in paths {
            let parts = path.split(separator: "/")
            if parts.count > 1 {
                for count in 1..<parts.count where paths.contains(parts.prefix(count).joined(separator: "/")) { throw problem("文件与目录路径冲突：" + path) }
            }
        }
    }
    static func write(parent: URL, name: String, files: [File]) throws -> URL {
        try validate(name: name, files: files)
        var root: URL!
        for suffix in 1...10000 {
            let candidate = parent.appendingPathComponent(suffix == 1 ? name : "\(name)-\(suffix)", isDirectory: true)
            let result = candidate.path.withCString { Darwin.mkdir($0, 0o755) }
            if result == 0 { root = candidate; break }
            if errno != EEXIST { throw problem("无法创建固件目录：" + String(cString: strerror(errno))) }
        }
        guard let root = root else { throw problem("同名目录过多，请选择其他导出位置。") }
        do {
            for file in files {
                let url = root.appendingPathComponent(file.path)
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try Data(file.content.utf8).write(to: url, options: .withoutOverwriting)
            }
            return root
        } catch {
            try? FileManager.default.removeItem(at: root)
            throw error
        }
    }
}
