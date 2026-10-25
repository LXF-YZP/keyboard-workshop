import Foundation
import Security
import CryptoKit

// GitHub.com 的访问令牌只留在原生端；不放入工程、网页、URL 或日志。
enum GitHubCredential {
    static let service = "local.yuezhiping.keyboard-workshop.github"
    static var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "github.com"] }
    static func read() throws -> String? {
        var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let code = SecItemCopyMatching(q as CFDictionary, &result)
        if code == errSecItemNotFound { return nil }
        guard code == errSecSuccess, let data = result as? Data, let token = String(data: data, encoding: .utf8) else { throw GitHubFirmware.problem("无法读取系统钥匙串，请重新连接 GitHub。") }
        return token
    }
    static func save(_ token: String) throws {
        let attributes: [String: Any] = [kSecValueData as String: Data(token.utf8)]
        var code = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if code == errSecItemNotFound {
            var q = query; q.merge(attributes) { _, new in new }; q[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlocked
            code = SecItemAdd(q as CFDictionary, nil)
        }
        guard code == errSecSuccess else { throw GitHubFirmware.problem("无法将令牌保存到系统钥匙串。") }
    }
    static func remove() throws {
        let code = SecItemDelete(query as CFDictionary)
        guard code == errSecSuccess || code == errSecItemNotFound else { throw GitHubFirmware.problem("无法移除钥匙串中的 GitHub 令牌。") }
    }
}

final class GitHubNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

final class GitHubFirmware {
    struct Repository: Codable {
        var name: String; var owner: String; var id: Int; var keyboard: String; var target: String
        var initialHead: String? // 新建后上传中断时，仅允许在原始提交上重试。
    }
    struct Job: Codable {
        var owner: String; var repo: String; var sha: String; var branch: String
        var runID: Int?; var status = "waiting"; var conclusion: String?; var artifactID: Int?
        var snapshotId: String?; var projectName: String?; var generatorVersion: String?; var filesDigest: String?
        var startedAt = Date().timeIntervalSince1970
        var url: String { "https://github.com/\(owner)/\(repo)/actions" + (runID.map { "/runs/\($0)" } ?? "") }
        var finished: Bool { status == "completed" }
    }
    struct PublishReview {
        var owner: String; var name: String; var isPrivate: Bool; var branch: String
        var changes: [String]; var creating: Bool
    }
    static func filesDigest(_ files: [FirmwareExport.File]) -> String {
        let bytes = files.sorted { $0.path < $1.path }.map { $0.path + "\u{0}" + $0.content + "\u{0}" }.joined()
        return SHA256.hash(data: Data(bytes.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    static func blobSHA(_ content: String) -> String {
        let data = Data(("blob " + String(content.utf8.count) + "\u{0}" + content).utf8)
        return Insecure.SHA1.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
    struct Settings: Codable { var login = ""; var repositories = [Repository](); var job: Job? }
    struct Manifest: Codable { var version = 1; var app = "keyboard-workshop"; var keyboard: String; var target: String; var files: [String] }
    static let marker = ".keyboard-workshop.json"
    let session: URLSession
    let publicSession: URLSession
    let token: String
    init(token: String, session: URLSession? = nil, publicSession: URLSession? = nil) {
        self.token = token
        let config = URLSessionConfiguration.ephemeral; config.timeoutIntervalForRequest = 40; config.timeoutIntervalForResource = 300
        self.session = session ?? URLSession(configuration: config, delegate: GitHubNoRedirect(), delegateQueue: nil)
        self.publicSession = publicSession ?? URLSession(configuration: config)
    }
    static func problem(_ message: String) -> NSError { NSError(domain: "KeyboardWorkshop.GitHub", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
    static func validName(_ value: String) -> Bool { value.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$", options: .regularExpression) != nil }
    static func validSHA(_ value: String) -> Bool { value.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil }
    static func allowed(_ path: String, keyboard: String, target: String) -> Bool {
        if ["README.md", ".gitignore", ".github/workflows/build.yml"].contains(path) { return true }
        if target == "qmk" { return path.hasPrefix("keyboards/handwired/\(keyboard)/") }
        return ["config/\(keyboard).keymap", "config/\(keyboard).conf", "config/west.yml", "build.yaml", "zephyr/module.yml"].contains(path) || path.hasPrefix("boards/shields/\(keyboard)/")
    }
    static func validate(files: [FirmwareExport.File], keyboard: String, target: String) throws {
        guard keyboard.range(of: "^[a-z][a-z0-9_]{0,31}$", options: .regularExpression) != nil, ["qmk", "zmk"].contains(target) else { throw problem("固件标识或目标无效。") }
        try FirmwareExport.validate(name: keyboard, files: files)
        guard files.contains(where: { $0.path == ".github/workflows/build.yml" }), files.allSatisfy({ allowed($0.path, keyboard: keyboard, target: target) }) else { throw problem("上传文件超出当前固件目录，或缺少编译流程。") }
    }
    func request(_ method: String = "GET", _ path: String, query: [URLQueryItem] = [], body: [String: Any]? = nil, allowed: Set<Int> = [200, 201, 204]) async throws -> (Data, HTTPURLResponse) {
        try Task.checkCancellation()
        var components = URLComponents(); components.scheme = "https"; components.host = "api.github.com"; components.path = path
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw Self.problem("GitHub 请求地址无效。") }
        var req = URLRequest(url: url); req.httpMethod = method
        req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        req.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        req.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        req.setValue("KeyboardWorkshop/1.4", forHTTPHeaderField: "User-Agent")
        if let body = body { req.httpBody = try JSONSerialization.data(withJSONObject: body); req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let data: Data, response: URLResponse
        do { (data, response) = try await session.data(for: req) }
        catch is CancellationError { throw CancellationError() }
        catch { try Task.checkCancellation(); throw Self.problem("无法连接 GitHub，请检查网络后重试。") }
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else { throw Self.problem("GitHub 响应无效。") }
        guard allowed.contains(http.statusCode) else {
            switch http.statusCode {
            case 401: throw Self.problem("GitHub 令牌无效或已过期，请重新连接。")
            case 403: throw Self.problem("GitHub 拒绝请求：请检查令牌的 repo / workflow 权限、Actions 设置或 API 额度。")
            case 404: throw Self.problem("GitHub 仓库或编译记录不存在，或当前账号无访问权限。")
            case 409, 422: throw Self.problem("GitHub 未接受更新：仓库可能重名、分支受保护或已有新提交。请刷新后重试。")
            case 429: throw Self.problem("GitHub 请求过于频繁，请稍后刷新。")
            default: throw Self.problem("GitHub 服务暂不可用（HTTP \(http.statusCode)），请稍后重试。")
            }
        }
        return (data, http)
    }
    func json(_ method: String = "GET", _ path: String, query: [URLQueryItem] = [], body: [String: Any]? = nil) async throws -> [String: Any] {
        let (data, _) = try await request(method, path, query: query, body: body)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Self.problem("GitHub 返回的数据格式无效。") }
        return object
    }
    func account() async throws -> String {
        let user = try await json("GET", "/user")
        guard let login = user["login"] as? String, Self.validName(login), user["type"] as? String == "User" else { throw Self.problem("请连接 GitHub 个人账号。") }
        return login
    }
    @MainActor func publish(files: [FirmwareExport.File], keyboard: String, target: String, owner: String, name: String, isPrivate: Bool, existing: Repository?, created: (Repository) throws -> Void, progress: (String) -> Void, confirm: ((PublishReview) async -> Bool)? = nil) async throws -> (Repository, Job) {
        try Self.validate(files: files, keyboard: keyboard, target: target)
        guard Self.validName(owner), Self.validName(name) else { throw Self.problem("仓库名称仅支持英文字母、数字、短横线和下划线。") }
        let login = try await account()
        guard login.lowercased() == owner.lowercased() else { throw Self.problem("GitHub 账号已变化，请重新选择仓库。") }
        let base = "/repos/\(owner)/\(name)"
        progress(existing == nil ? "正在创建 GitHub 仓库…" : "正在核对仓库…")
        let remote: [String: Any]
        if existing == nil {
            if let confirm = confirm, !(await confirm(PublishReview(owner: login, name: name, isPrivate: isPrivate, branch: "GitHub 新仓库默认分支", changes: files.map { "新增 " + $0.path }, creating: true))) { throw Self.problem("已取消发布，未创建仓库。") }
            remote = try await json("POST", "/user/repos", body: ["name": name, "private": isPrivate, "auto_init": true, "description": "Keyboard Workshop \(target.uppercased()) firmware"])
        } else { remote = try await json("GET", base) }
        guard let repoID = remote["id"] as? Int, let branch = remote["default_branch"] as? String,
              (remote["owner"] as? [String: Any])?["login"] as? String == login,
              remote["archived"] as? Bool != true, remote["fork"] as? Bool != true else { throw Self.problem("只能上传到当前账号拥有的普通固件仓库。") }
        if let old = existing {
            guard old.id == repoID, old.keyboard == keyboard, old.target == target, old.owner.lowercased() == login.lowercased() else { throw Self.problem("该仓库与当前键盘或固件目标不匹配，请新建仓库。") }
        }
        var repository = existing ?? Repository(name: name, owner: login, id: repoID, keyboard: keyboard, target: target)
        if existing == nil { try created(repository) }
        // 新建成功即记录仓库 ID，后续网络中断时仍能选择该仓库重试。
        let reference = try await json("GET", base + "/git/ref/heads/" + branch)
        guard let head = (reference["object"] as? [String: Any])?["sha"] as? String, Self.validSHA(head) else { throw Self.problem("无法读取仓库分支。") }
        if existing == nil { repository.initialHead = head; try created(repository) }
        let commit = try await json("GET", base + "/git/commits/" + head)
        guard let treeSHA = (commit["tree"] as? [String: Any])?["sha"] as? String, Self.validSHA(treeSHA) else { throw Self.problem("无法读取仓库文件树。") }
        let tree = try await json("GET", base + "/git/trees/" + treeSHA, query: [.init(name: "recursive", value: "1")])
        guard tree["truncated"] as? Bool != true, let entries = tree["tree"] as? [[String: Any]] else { throw Self.problem("仓库文件过多，无法安全更新；请新建专用固件仓库。") }
        let remotePaths = Set(entries.compactMap { $0["path"] as? String })
        var previous = [String]()
        if remotePaths.contains(Self.marker) {
            let content = try await json("GET", base + "/contents/" + Self.marker, query: [.init(name: "ref", value: head)])
            guard let encoded = content["content"] as? String, let data = Data(base64Encoded: encoded, options: .ignoreUnknownCharacters),
                  let manifest = try? JSONDecoder().decode(Manifest.self, from: data), manifest.version == 1, manifest.app == "keyboard-workshop", manifest.keyboard == keyboard, manifest.target == target,
                  manifest.files.allSatisfy({ FirmwareExport.validPath($0) && Self.allowed($0, keyboard: keyboard, target: target) }) else { throw Self.problem("仓库缺少匹配的键盘工坊标记，请新建仓库。") }
            previous = manifest.files
        } else {
            let untouched = repository.initialHead == nil && (commit["parents"] as? [[String: Any]])?.isEmpty == true && remotePaths == ["README.md"]
            guard repository.initialHead == head || untouched else { throw Self.problem("仓库缺少工坊标记，且初始文件已被修改；请新建仓库。") }
            previous = ["README.md"]
        }
        let managed = Set(previous + [Self.marker]), paths = Set(files.map { $0.path } + [Self.marker])
        for entry in entries {
            guard let path = entry["path"] as? String else { continue }
            if paths.contains(path), !managed.contains(path) { throw Self.problem("仓库已有同名文件 \(path)，请新建仓库以保留原文件。") }
            if paths.contains(path) || managed.contains(path), entry["type"] as? String != "blob" || entry["mode"] as? String != "100644" { throw Self.problem("仓库存在不兼容文件，无法直接更新。") }
            if entry["type"] as? String != "tree", paths.contains(where: { $0.hasPrefix(path + "/") }) { throw Self.problem("仓库文件与固件目录冲突，请新建仓库。") }
        }
        if existing != nil, let confirm = confirm {
            let blobs = Dictionary(entries.compactMap { e -> (String, String)? in guard let path = e["path"] as? String, let sha = e["sha"] as? String else { return nil }; return (path, sha) }, uniquingKeysWith: { first, _ in first })
            var summary = files.compactMap { file -> String? in
                guard let old = blobs[file.path] else { return "新增 " + file.path }
                return old == Self.blobSHA(file.content) ? nil : "更新 " + file.path
            }
            summary += previous.filter { !paths.contains($0) && remotePaths.contains($0) }.map { "删除 " + $0 }
            summary.append("更新工坊仓库清单 " + Self.marker)
            guard await confirm(PublishReview(owner: login, name: name, isPrivate: remote["private"] as? Bool ?? true, branch: branch, changes: summary, creating: false)) else { throw Self.problem("已取消发布，未更新仓库。") }
        }
        // Recheck after the native confirmation; never reuse approval for a
        // different head, branch, owner, visibility or repository identity.
        let latest = try await json("GET", base)
        let latestRef = try await json("GET", base + "/git/ref/heads/" + branch)
        guard latest["id"] as? Int == repoID, latest["default_branch"] as? String == branch,
              latest["private"] as? Bool == remote["private"] as? Bool,
              (latestRef["object"] as? [String: Any])?["sha"] as? String == head else { throw Self.problem("仓库在确认期间发生变化，请重新准备发布。") }
        progress("正在上传 \(files.count) 个固件文件…")
        let manifest = Manifest(keyboard: keyboard, target: target, files: files.map { $0.path }.sorted())
        let markerData = try JSONEncoder().encode(manifest)
        var updated = files; updated.append(.init(path: Self.marker, content: String(decoding: markerData, as: UTF8.self)))
        var changes: [[String: Any]] = updated.map { ["path": $0.path, "mode": "100644", "type": "blob", "content": $0.content] }
        changes += previous.filter { !paths.contains($0) && remotePaths.contains($0) }.map { ["path": $0, "mode": "100644", "type": "blob", "sha": NSNull()] }
        let newTree = try await json("POST", base + "/git/trees", body: ["base_tree": treeSHA, "tree": changes])
        guard let newTreeSHA = newTree["sha"] as? String, Self.validSHA(newTreeSHA) else { throw Self.problem("上传文件树失败。") }
        let newCommit = try await json("POST", base + "/git/commits", body: ["message": "Update \(keyboard) \(target.uppercased()) firmware from Keyboard Workshop", "tree": newTreeSHA, "parents": [head]])
        guard let sha = newCommit["sha"] as? String, Self.validSHA(sha) else { throw Self.problem("创建固件提交失败。") }
        progress("正在提交并触发 GitHub Actions…")
        _ = try await json("PATCH", base + "/git/refs/heads/" + branch, body: ["sha": sha, "force": false])
        repository.initialHead = nil
        return (repository, Job(owner: login, repo: name, sha: sha, branch: branch))
    }
    func refresh(_ original: Job) async throws -> Job {
        var job = original
        let base = "/repos/\(job.owner)/\(job.repo)/actions"
        // 查询所有工作流，首次推送后 build.yml 尚在注册时也可正常等待。
        let response = try await json("GET", base + "/runs", query: [.init(name: "head_sha", value: job.sha), .init(name: "event", value: "push"), .init(name: "per_page", value: "100")])
        let runs = response["workflow_runs"] as? [[String: Any]] ?? []
        if let run = runs.filter({ $0["head_sha"] as? String == job.sha && $0["event"] as? String == "push" && $0["path"] as? String == ".github/workflows/build.yml" }).max(by: { ($0["id"] as? Int ?? 0) < ($1["id"] as? Int ?? 0) }), let id = run["id"] as? Int {
            job.runID = id; job.status = run["status"] as? String ?? "queued"; job.conclusion = run["conclusion"] as? String
            job.artifactID = nil
            if job.finished && job.conclusion == "success" {
                let artifacts = try await json("GET", base + "/runs/\(id)/artifacts", query: [.init(name: "per_page", value: "100")])
                job.artifactID = (artifacts["artifacts"] as? [[String: Any]])?.first(where: { $0["name"] as? String == "firmware" && $0["expired"] as? Bool == false })?["id"] as? Int
            }
        }
        return job
    }
    func logs(_ job: Job) async throws -> String {
        guard let run = job.runID, Self.validName(job.owner), Self.validName(job.repo), Self.validSHA(job.sha) else { throw Self.problem("尚无可读取的构建日志，请先刷新。") }
        let base = "/repos/\(job.owner)/\(job.repo)/actions"
        let runInfo = try await json("GET", base + "/runs/\(run)")
        guard runInfo["head_sha"] as? String == job.sha, runInfo["path"] as? String == ".github/workflows/build.yml" else { throw Self.problem("构建与记录的提交不匹配。") }
        let data = try await json("GET", base + "/runs/\(run)/jobs", query: [.init(name: "per_page", value: "100")])
        let jobs = (data["jobs"] as? [[String: Any]] ?? []).sorted { ($0["conclusion"] as? String == "failure" ? 0 : 1) < ($1["conclusion"] as? String == "failure" ? 0 : 1) }
        var output = [String]()
        for job in jobs.prefix(3) {
            guard let id = job["id"] as? Int, job["status"] as? String == "completed" else { continue }
            let (direct, http) = try await request("GET", base + "/jobs/\(id)/logs", allowed: [200, 302])
            let bytes: Data
            if http.statusCode == 200 { bytes = direct }
            else {
                guard let location = http.value(forHTTPHeaderField: "Location"), let url = URL(string: location), url.scheme == "https", url.user == nil, url.password == nil else { throw Self.problem("日志下载地址无效。") }
                let (file, response) = try await publicSession.download(from: url)
                defer { try? FileManager.default.removeItem(at: file) }
                try Task.checkCancellation()
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw Self.problem("日志下载失败。") }
                let handle = try FileHandle(forReadingFrom: file); defer { try? handle.close() }
                let length = try handle.seekToEnd(); try handle.seek(toOffset: length > 120000 ? length - 120000 : 0)
                bytes = try handle.read(upToCount: 120000) ?? Data()
            }
            let text = String(decoding: bytes.suffix(120000), as: UTF8.self).replacingOccurrences(of: token, with: "[凭证已隐藏]")
            let lines = text.components(separatedBy: .newlines)
            let errors = lines.enumerated().filter { $0.element.range(of: "error|fatal|failed|undefined|not found", options: [.regularExpression, .caseInsensitive]) != nil }.prefix(30)
            var included = Set<Int>(); for line in errors { for n in max(0, line.offset-2)...min(lines.count-1, line.offset+3) { included.insert(n) } }
            let excerpt = included.isEmpty ? String(text.suffix(7000)) : included.sorted().map { lines[$0] }.joined(separator: "\n")
            output.append("任务：\(job["name"] as? String ?? String(id))\n" + excerpt)
        }
        guard !output.isEmpty else { throw Self.problem("任务尚未完成或日志不可用；请稍后刷新。") }
        return String(output.joined(separator: "\n\n").prefix(24000))
    }
    // 先取得 GitHub 的签名下载地址，再使用完全不带令牌的独立会话下载 ZIP。
    func download(_ job: Job) async throws -> URL {
        guard job.finished, job.conclusion == "success", let id = job.artifactID else { throw Self.problem("固件尚未生成，请刷新编译状态。") }
        let (_, http) = try await request("GET", "/repos/\(job.owner)/\(job.repo)/actions/artifacts/\(id)/zip", allowed: [302])
        guard let location = http.value(forHTTPHeaderField: "Location"), let url = URL(string: location), url.scheme == "https", url.user == nil, url.password == nil else { throw Self.problem("固件下载地址无效。") }
        let (temporary, response) = try await publicSession.download(from: url)
        do {
            try Task.checkCancellation()
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw Self.problem("固件下载失败，请刷新后重试。") }
            let handle = try FileHandle(forReadingFrom: temporary); defer { try? handle.close() }
            guard try handle.read(upToCount: 4) == Data([0x50, 0x4b, 0x03, 0x04]) else { throw Self.problem("下载结果不是有效的固件 ZIP，请打开 GitHub 检查。") }
        } catch { try? FileManager.default.removeItem(at: temporary); throw error }
        return temporary
    }
}
