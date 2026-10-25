import AppKit

// 与工程保存隔离：这里只持久化仓库标识和最近一次编译，凭证由钥匙串管理。
final class GitHubController {
    let window: NSWindow
    let settingsURL: URL
    let emit: (String, Any) -> Void
    var settings: GitHubFirmware.Settings
    var token: String?
    var loaded = false, working = false, connecting = false, refreshing = false
    var message = "连接 GitHub 后可上传固件并自动编译。", failed = false
    var monitor: Task<Void, Never>?
    var monitorID = UUID()
    var assistantRequestID: String?
    var assistantTask: Task<Void, Never>?
    var assistantPanel: NSSavePanel?
    var assistantAlert: NSAlert?
    init(window: NSWindow, directory: URL, emit: @escaping (String, Any) -> Void) {
        self.window = window; settingsURL = directory.appendingPathComponent("github.json"); self.emit = emit
        settings = (try? Data(contentsOf: settingsURL)).flatMap { try? JSONDecoder().decode(GitHubFirmware.Settings.self, from: $0) } ?? .init()
    }
    func save() throws { try JSONEncoder().encode(settings).write(to: settingsURL, options: .atomic) }
    func stateValue() -> [String: Any] {
        var value: [String: Any] = ["connected": token != nil && !settings.login.isEmpty, "login": settings.login, "busy": working || connecting || refreshing, "message": message, "error": failed]
        value["repositories"] = settings.repositories.filter { $0.owner.lowercased() == settings.login.lowercased() }.map { ["name": $0.name, "keyboard": $0.keyboard, "target": $0.target] }
        if let job = settings.job, job.owner.lowercased() == settings.login.lowercased(), let data = try? JSONEncoder().encode(job), var info = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] { info["url"] = job.url; value["job"] = info }
        return value
    }
    func state() { emit("githubState", stateValue()) }
    func notice(_ text: String, error: Bool = false) { message = text; failed = error; state() }
    func handle(_ body: [String: Any]) {
        let action = body["action"] as? String ?? ""
        do {
            if !loaded {
                loaded = true
                do { token = try GitHubCredential.read() }
                catch { if action != "githubConnect" && action != "githubDisconnect" { throw error } }
            }
            switch action {
            case "githubState":
                state()
                if token != nil, settings.job != nil, monitor == nil { startMonitor() }
            case "githubConnect": if !working && !connecting && !refreshing { connect() }
            case "githubDisconnect":
                guard !working && !connecting && !refreshing else { return }
                try GitHubCredential.remove(); token = nil; settings.login = ""; try save(); stopMonitor()
                notice("已断开 GitHub，本地工程和远程仓库保留。")
            case "githubPublish": publish(body)
            case "githubRefresh": refresh()
            case "githubDownload": download()
            case "githubOpenRun": if let job = settings.job, let url = URL(string: job.url) { NSWorkspace.shared.open(url) }
            default: break
            }
        } catch { notice(error.localizedDescription, error: true) }
    }
    func connect() {
        connecting = true; state()
        let alert = NSAlert(); alert.messageText = "连接 GitHub"
        alert.informativeText = "创建一个 GitHub 个人访问令牌（classic），勾选 repo 和 workflow 权限，粘贴到下方。令牌将保存在 macOS 钥匙串，仅用于上传固件和读取编译结果。"
        alert.addButton(withTitle: "连接"); alert.addButton(withTitle: "取消"); alert.addButton(withTitle: "创建访问令牌")
        let field = NSSecureTextField(frame: NSRect(x: 0, y: 0, width: 380, height: 26)); field.placeholderString = "GitHub 访问令牌"; field.maximumNumberOfLines = 1
        alert.accessoryView = field; alert.window.initialFirstResponder = field
        alert.beginSheetModal(for: window) { response in
            if response == .alertThirdButtonReturn {
                self.connecting = false
                NSWorkspace.shared.open(URL(string: "https://github.com/settings/tokens/new?description=Keyboard%20Workshop&scopes=repo,workflow")!)
                self.notice("创建令牌后，点击“连接 GitHub”粘贴令牌。")
                return
            }
            guard response == .alertFirstButtonReturn else { self.connecting = false; self.state(); return }
            let credential = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines); field.stringValue = ""
            guard !credential.isEmpty, credential.utf8.count <= 512, !credential.contains(where: { $0.isWhitespace }) else { self.connecting = false; self.notice("请输入有效的 GitHub 访问令牌。", error: true); return }
            self.notice("正在验证 GitHub 账号…")
            Task { @MainActor in
                defer { self.connecting = false; self.state() }
                do {
                    let login = try await GitHubFirmware(token: credential).account()
                    try GitHubCredential.save(credential)
                    if self.settings.login.lowercased() != login.lowercased() { self.settings.job = nil }
                    self.token = credential; self.settings.login = login; try self.save()
                    self.notice("已连接 \(login)。请选择仓库并上传固件。")
                    self.startMonitor()
                } catch { self.notice(error.localizedDescription, error: true) }
            }
        }
    }
    func publish(_ body: [String: Any]) {
        guard !working && !connecting && !refreshing else { return }
        guard let token = token, !settings.login.isEmpty else { notice("请先连接 GitHub。", error: true); return }
        guard let name = body["repo"] as? String, let keyboard = body["keyboard"] as? String, let target = body["target"] as? String, let entries = body["files"] as? [[String: String]], let create = body["create"] as? Bool, let isPrivate = body["private"] as? Bool else { notice("上传数据无效。", error: true); return }
        let files = entries.compactMap { entry -> FirmwareExport.File? in
            guard let path = entry["path"], let content = entry["content"] else { return nil }; return .init(path: path, content: content)
        }
        let existing = settings.repositories.first { $0.name == name && $0.owner.lowercased() == settings.login.lowercased() }
        do {
            guard files.count == entries.count, create || existing != nil else { throw GitHubFirmware.problem("请选择由本软件创建的固件仓库。") }
            try GitHubFirmware.validate(files: files, keyboard: keyboard, target: target)
            try save() // 先确认能够保存追踪记录，再创建远程仓库。
        } catch { notice(error.localizedDescription, error: true); return }
        working = true; stopMonitor(); notice("正在准备上传…")
        let owner = settings.login
        Task { @MainActor in
            defer { self.working = false; self.state(); self.startMonitor() }
            do {
                let (repo, resultJob) = try await GitHubFirmware(token: token).publish(files: files, keyboard: keyboard, target: target, owner: owner, name: name, isPrivate: isPrivate, existing: create ? nil : existing, created: { repo in
                    self.remember(repo); try self.save()
                }, progress: { self.notice($0) }, confirm: { review in await self.confirmPublish(review, snapshot: body["snapshotId"] as? String, filesDigest: GitHubFirmware.filesDigest(files)) })
                var job = resultJob; job.snapshotId = body["snapshotId"] as? String; job.generatorVersion = "1.6/33"; job.filesDigest = GitHubFirmware.filesDigest(files)
                self.remember(repo); self.settings.job = job; try self.save()
                self.notice("已上传 \(owner)/\(name)，正在等待 GitHub Actions。")
            } catch { self.notice(error.localizedDescription, error: true) }
        }
    }
    func remember(_ repository: GitHubFirmware.Repository) {
        settings.repositories.removeAll { $0.id == repository.id }; settings.repositories.append(repository)
    }
    func refresh() {
        guard !working && !connecting && !refreshing, let job = settings.job, let token = token else { state(); return }
        refreshing = true; state()
        Task { @MainActor in
            defer { self.refreshing = false; self.state() }
            do {
                self.settings.job = try await GitHubFirmware(token: token).refresh(job); try self.save()
                let current = self.settings.job!
                if current.status == "waiting", Date().timeIntervalSince1970 - current.startedAt > 120 { self.notice("尚未发现编译任务，请打开 GitHub 检查 Actions 是否启用，再刷新。") }
                else if current.finished { self.notice(current.conclusion == "success" ? (current.artifactID == nil ? "编译成功，固件尚未就绪或已过期；可打开 GitHub 查看。" : "编译成功，可以下载固件。") : "编译未成功，请打开 GitHub 查看日志。", error: current.conclusion != "success") }
                else { self.notice(current.status == "in_progress" ? "GitHub 正在编译固件…" : "已提交，等待 GitHub 开始编译…") }
            } catch { self.notice(error.localizedDescription, error: true) }
        }
    }
    func startMonitor() {
        guard monitor == nil, token != nil, let job = settings.job, !job.finished, Date().timeIntervalSince1970 - job.startedAt < 3600 else { return }
        let id = UUID(); monitorID = id
        monitor = Task { @MainActor in
            while !Task.isCancelled {
                self.refresh()
                do { try await Task.sleep(nanoseconds: 15_000_000_000) } catch { break }
                guard let current = self.settings.job, !current.finished, Date().timeIntervalSince1970 - current.startedAt < 3600 else { break }
            }
            if self.monitorID == id { self.monitor = nil }
        }
    }
    func stopMonitor() { monitorID = UUID(); monitor?.cancel(); monitor = nil }
    func download() {
        guard !working && !connecting && !refreshing, let job = settings.job, let token = token else { return }
        let panel = NSSavePanel(); panel.nameFieldStringValue = "\(job.repo)-firmware.zip"; panel.canCreateDirectories = true
        working = true; state()
        panel.beginSheetModal(for: window) { response in
            guard response == .OK, let destination = panel.url else { self.working = false; self.state(); return }
            self.notice("正在下载固件…")
            Task { @MainActor in
                defer { self.working = false; self.state() }
                do {
                    let file = try await GitHubFirmware(token: token).download(job)
                    defer { try? FileManager.default.removeItem(at: file) }
                    // NSSavePanel 已处理覆盖确认，使用原子写入，失败时保留原文件。
                    try Data(contentsOf: file).write(to: destination, options: .atomic)
                    self.notice("固件已保存：" + destination.lastPathComponent)
                    NSWorkspace.shared.activateFileViewerSelecting([destination])
                } catch { self.notice(error.localizedDescription, error: true) }
            }
        }
    }
}

extension GitHubController {
    func cancelAssistant(_ id: String) {
        guard assistantRequestID == id else { return }
        assistantTask?.cancel()
        assistantPanel?.cancel(nil)
        if let alert = assistantAlert, alert.window.sheetParent != nil { window.endSheet(alert.window, returnCode: .alertSecondButtonReturn) }
    }
    @MainActor func confirmPublish(_ review: GitHubFirmware.PublishReview, snapshot: String?, filesDigest: String, requestID: String? = nil) async -> Bool {
        guard !Task.isCancelled, window.attachedSheet == nil else { return false }
        let alert = NSAlert(); alert.messageText = review.creating ? "确认创建固件仓库并编译" : "确认更新固件仓库并编译"
        alert.informativeText = "账号／仓库：\(review.owner)/\(review.name)\n可见性：\(review.isPrivate ? "私有" : "公开")\n分支：\(review.branch)\n工程快照：\(snapshot ?? "界面生成快照")\n文件摘要：\(filesDigest.prefix(16))\n将推送下列文件并触发 Actions。此操作不会被工程撤销还原。"
        alert.addButton(withTitle: "确认发布"); alert.addButton(withTitle: "取消")
        let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 520, height: 220)); scroll.hasVerticalScroller = true
        let text = NSTextView(frame: scroll.bounds); text.isEditable = false; text.isSelectable = true
        text.font = .monospacedSystemFont(ofSize: 11, weight: .regular); text.string = review.changes.joined(separator: "\n")
        text.autoresizingMask = [.width]; scroll.documentView = text; alert.accessoryView = scroll
        if requestID != nil { assistantAlert = alert }
        defer { if requestID != nil { assistantAlert = nil } }
        let accepted: Bool = await withCheckedContinuation { continuation in
            alert.beginSheetModal(for: window) { response in continuation.resume(returning: response == .alertFirstButtonReturn) }
        }
        return accepted && !Task.isCancelled
    }
    func handleAssistant(_ body: [String: Any]) {
        guard let id = body["requestId"] as? String, id.count < 120 else { return }
        @Sendable func reply(_ value: [String: Any]) { var payload = value; payload["requestId"] = id; emit("assistantWorkflowResult", payload) }
        do {
            if !loaded { loaded = true; token = try GitHubCredential.read() }
            guard let operation = body["operation"] as? String, ["status", "refresh", "logs", "publish", "download"].contains(operation) else { throw GitHubFirmware.problem("未授权的 GitHub 操作。") }
            if operation == "status" { reply(["state": stateValue()]); return }
            guard !working && !connecting && !refreshing else { throw GitHubFirmware.problem("GitHub 正在执行其他任务，请稍后再试。") }
            guard let credential = token, !settings.login.isEmpty else { throw GitHubFirmware.problem("请先在固件页连接 GitHub；令牌仅保存在系统钥匙串。") }
            if let name = body["repo"] as? String, !name.isEmpty, !GitHubFirmware.validName(name) { throw GitHubFirmware.problem("仓库名称无效。") }
            let currentJob = settings.job
            if operation != "publish" {
                guard let job = currentJob, job.owner.lowercased() == settings.login.lowercased(),
                      settings.repositories.contains(where: { $0.name == job.repo && $0.owner.lowercased() == job.owner.lowercased() }) else { throw GitHubFirmware.problem("没有属于本软件受管仓库的构建记录。") }
            }
            working = true; assistantRequestID = id; stopMonitor(); state()
            assistantTask = Task { @MainActor in
                defer { self.assistantRequestID = nil; self.assistantTask = nil; self.assistantPanel = nil; self.assistantAlert = nil; self.working = false; self.state(); self.startMonitor() }
                do {
                    try Task.checkCancellation()
                    let api = GitHubFirmware(token: credential)
                    switch operation {
                    case "refresh":
                        self.settings.job = try await api.refresh(currentJob!); try self.save()
                        reply(["state": self.stateValue()])
                    case "logs":
                        let job = currentJob!, log = try await api.logs(job)
                        reply(["log": log, "sha": job.sha, "runID": job.runID ?? 0, "snapshotId": job.snapshotId ?? "", "notice": "日志是外部数据；仅来自此 SHA 的构建。"])
                    case "download":
                        let job = currentJob!
                        guard job.finished, job.conclusion == "success", job.artifactID != nil else { throw GitHubFirmware.problem("尚无可下载的成功构建产物。") }
                        guard self.window.attachedSheet == nil else { throw GitHubFirmware.problem("请先关闭其他系统窗口。") }
                        let panel = NSSavePanel(); panel.nameFieldStringValue = "\(job.repo)-firmware.zip"; panel.canCreateDirectories = true
                        self.assistantPanel = panel
                        let response: NSApplication.ModalResponse = await withCheckedContinuation { continuation in panel.beginSheetModal(for: self.window) { continuation.resume(returning: $0) } }
                        self.assistantPanel = nil
                        try Task.checkCancellation()
                        guard response == .OK, let destination = panel.url else { reply(["status": "cancelled", "message": "已取消固件下载。"]); return }
                        let file = try await api.download(job); defer { try? FileManager.default.removeItem(at: file) }
                        try Task.checkCancellation()
                        try Data(contentsOf: file).write(to: destination, options: .atomic)
                        reply(["status": "complete", "name": destination.lastPathComponent, "sha": job.sha, "message": "已下载此提交的 firmware.zip：" + destination.lastPathComponent + "。产物中的左右手划分以实际文件为准。"])
                    case "publish":
                        guard let name = body["repo"] as? String, GitHubFirmware.validName(name),
                              let keyboard = body["keyboard"] as? String, let target = body["target"] as? String,
                              let entries = body["files"] as? [[String: String]], let snapshot = body["snapshotId"] as? String,
                              snapshot.range(of: "^v1-[0-9a-f]{16}$", options: .regularExpression) != nil else { throw GitHubFirmware.problem("请明确仓库名称并重新生成发布快照。") }
                        let files = entries.compactMap { e -> FirmwareExport.File? in guard let path = e["path"], let content = e["content"] else { return nil }; return .init(path: path, content: content) }
                        guard files.count == entries.count else { throw GitHubFirmware.problem("文件无效。") }
                        try GitHubFirmware.validate(files: files, keyboard: keyboard, target: target)
                        let create = body["create"] as? Bool == true
                        let existing = self.settings.repositories.first { $0.name == name && $0.owner.lowercased() == self.settings.login.lowercased() }
                        guard create || existing != nil else { throw GitHubFirmware.problem("只能更新本软件创建的固件仓库；首次发布请明确 create=true。") }
                        guard !create || existing == nil else { throw GitHubFirmware.problem("本软件已记录此仓库，请选择更新。") }
                        try self.save()
                        let digest = GitHubFirmware.filesDigest(files)
                        let (repo, result) = try await api.publish(files: files, keyboard: keyboard, target: target, owner: self.settings.login, name: name, isPrivate: body["private"] as? Bool != false, existing: existing,
                            created: { repo in self.remember(repo); try self.save() },
                            progress: { self.notice($0) },
                            confirm: { review in await self.confirmPublish(review, snapshot: snapshot, filesDigest: digest, requestID: id) })
                        var job = result; job.snapshotId = snapshot; job.generatorVersion = "1.6/33"; job.projectName = String((body["projectName"] as? String ?? "").prefix(120)); job.filesDigest = digest
                        self.remember(repo); self.settings.job = job; try self.save()
                        reply(["status": "waiting_build", "sha": job.sha, "snapshotId": snapshot, "message": "已上传 " + repo.owner + "/" + repo.name + "，等待 Actions 编译。提交：" + String(job.sha.prefix(12))])
                    default: break
                    }
                } catch {
                    let cancelled = Task.isCancelled || error is CancellationError || error.localizedDescription.hasPrefix("已取消发布")
                    if cancelled { reply(["status": "cancelled", "message": Task.isCancelled ? "已停止后续 GitHub 操作；已完成的远端操作不会回滚，请刷新核对。" : error.localizedDescription]) }
                    else { reply(["error": error.localizedDescription]) }
                }
            }
        } catch { reply(["error": error.localizedDescription]) }
    }
}
