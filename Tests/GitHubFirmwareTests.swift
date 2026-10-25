import Foundation

// 所有请求由 URLProtocol 拦截，不使用真实账号、网络或钥匙串。
final class GitHubMock: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, [String: String], Data))!
    static var failures = [String]()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, headers, data) = try Self.handler(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        } catch { Self.failures.append(error.localizedDescription); client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

@main enum GitHubTests {
    static let head = String(repeating: "a", count: 40), tree = String(repeating: "b", count: 40), sha = String(repeating: "c", count: 40)
    static var checks = 0
    static func check(_ condition: Bool, _ message: String) throws {
        guard condition else { throw NSError(domain: "Test", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }; checks += 1
    }
    static func json(_ value: [String: Any], status: Int = 200) throws -> (Int, [String: String], Data) { (status, ["Content-Type": "application/json"], try JSONSerialization.data(withJSONObject: value)) }
    static func body(_ r: URLRequest) throws -> [String: Any] {
        var data = r.httpBody ?? Data()
        if data.isEmpty, let stream = r.httpBodyStream {
            stream.open(); defer { stream.close() }; var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: buffer.count); if n <= 0 { break }; data.append(buffer, count: n) }
        }
        return (try JSONSerialization.jsonObject(with: data)) as! [String: Any]
    }
    static func reject(_ message: String, operation: () async throws -> Void) async throws {
        do { try await operation(); throw NSError(domain: "ExpectedRejection", code: 0) }
        catch { try check((error as NSError).domain != "ExpectedRejection", message) }
    }
    @MainActor static func main() async throws {
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [GitHubMock.self]
        let api = GitHubFirmware(token: "test-secret-never-display", session: URLSession(configuration: config), publicSession: URLSession(configuration: config))
        let files: [FirmwareExport.File] = [.init(path: ".github/workflows/build.yml", content: "name: 编译\non: [push]\n"), .init(path: "README.md", content: "中文接线说明\n"), .init(path: "keyboards/handwired/test_board/config.h", content: "#pragma once\n")]
        let oldPath = "keyboards/handwired/test_board/old.c"
        var mode = "new", posts = 0, patches = 0, marker = false, remoteMode = "100644", wrongOwner = false, wrongID = false, status = 200, interruptRef = false
        var treeBody = [String: Any](), recorded: GitHubFirmware.Repository?
        GitHubMock.handler = { r in
            let path = r.url!.path, method = r.httpMethod!
            try check(r.url!.host == "api.github.com", "API host")
            try check(r.value(forHTTPHeaderField: "Authorization") == "Bearer test-secret-never-display", "API authorization")
            if status != 200 { return try json(["message": "never echo test-secret-never-display"], status: status) }
            if path == "/user" { return try json(["login": "tester", "type": "User"]) }
            if path == "/user/repos" || path == "/repos/tester/board-qmk" {
                if method == "POST" { let b = try body(r); try check(b["private"] as? Bool == true && b["auto_init"] as? Bool == true, "private repo by default"); posts += 1 }
                return try json(["id": wrongID ? 99 : 42, "owner": ["login": wrongOwner ? "other" : "tester"], "default_branch": "firmware/main", "fork": false, "archived": false])
            }
            if path.hasSuffix("/git/ref/heads/firmware/main") {
                if interruptRef { return try json([:], status: 503) }
                return try json(["object": ["sha": head]])
            }
            if path.hasSuffix("/git/commits/" + head) { return try json(["tree": ["sha": tree], "parents": mode == "new" ? [] : [["sha": head]]]) }
            if path.hasSuffix("/git/trees/" + tree) {
                var entries: [[String: Any]] = [["path": "README.md", "type": "blob", "mode": "100644"]]
                if marker { entries += [["path": GitHubFirmware.marker, "type": "blob", "mode": "100644"], ["path": oldPath, "type": remoteMode == "040000" ? "tree" : "blob", "mode": remoteMode], ["path": "personal/notes.md", "type": "blob", "mode": "100644"]] }
                if mode == "collision" { entries.append(["path": ".github/workflows/build.yml", "type": "blob", "mode": "100644"]) }
                if mode == "ancestor" { entries.append(["path": "keyboards", "type": "blob", "mode": "100644"]) }
                return try json(["tree": entries, "truncated": false])
            }
            if path.hasSuffix("/contents/" + GitHubFirmware.marker) {
                let manifest = GitHubFirmware.Manifest(keyboard: "test_board", target: "qmk", files: ["README.md", oldPath])
                return try json(["content": try JSONEncoder().encode(manifest).base64EncodedString()])
            }
            if method == "POST" && path.hasSuffix("/git/trees") { treeBody = try body(r); return try json(["sha": tree]) }
            if method == "POST" && path.hasSuffix("/git/commits") { try check(try body(r)["parents"] as? [String] == [head], "preserve parent commit"); return try json(["sha": sha]) }
            if method == "PATCH" && path.hasSuffix("/git/refs/heads/firmware/main") { let b = try body(r); try check(b["force"] as? Bool == false, "no force push"); patches += 1; return try json(["object": ["sha": sha]]) }
            throw GitHubFirmware.problem("Unexpected mocked route: " + path)
        }
        func publish(_ old: GitHubFirmware.Repository? = nil) async throws -> (GitHubFirmware.Repository, GitHubFirmware.Job) {
            try await api.publish(files: files, keyboard: "test_board", target: "qmk", owner: "tester", name: "board-qmk", isPrivate: true, existing: old, created: { recorded = $0 }, progress: { _ in })
        }
        let (repo, job) = try await publish()
        try check(posts == 1 && patches == 1 && recorded?.id == 42 && repo.initialHead == nil, "new repository tracked")
        let changes = treeBody["tree"] as! [[String: Any]]
        try check(changes.contains { $0["content"] as? String == "中文接线说明\n" } && changes.contains { $0["path"] as? String == ".github/workflows/build.yml" }, "UTF8 and hidden workflow preserved")
        try check(job.sha == sha && job.branch == "firmware/main", "run tied to pushed SHA")
        mode = "update"; marker = true
        _ = try await publish(repo)
        let update = treeBody["tree"] as! [[String: Any]]
        try check(update.contains { $0["path"] as? String == oldPath && $0["sha"] is NSNull }, "only obsolete generated file deleted")
        try check(!update.contains { $0["path"] as? String == "personal/notes.md" }, "unrelated file retained")
        remoteMode = "040000"; try await reject("never delete user directory replacing managed file") { _ = try await publish(repo) }; remoteMode = "100644"
        marker = false; try await reject("unmarked existing repo refused") { _ = try await publish(repo) }
        mode = "collision"; try await reject("unmanaged same path refused") { _ = try await publish(GitHubFirmware.Repository(name: repo.name, owner: repo.owner, id: repo.id, keyboard: repo.keyboard, target: repo.target, initialHead: head)) }
        mode = "ancestor"; try await reject("ancestor file conflict refused") { _ = try await publish(GitHubFirmware.Repository(name: repo.name, owner: repo.owner, id: repo.id, keyboard: repo.keyboard, target: repo.target, initialHead: head)) }
        mode = "new"; wrongOwner = true; try await reject("wrong owner refused") { _ = try await publish(repo) }; wrongOwner = false
        wrongID = true; try await reject("different repository ID refused") { _ = try await publish(repo) }; wrongID = false
        var wrongTarget = repo; wrongTarget.target = "zmk"; try await reject("wrong target refused") { _ = try await publish(wrongTarget) }
        interruptRef = true; recorded = nil; try await reject("creation interruption") { _ = try await publish() }; try check(recorded?.id == 42 && recorded?.initialHead == nil, "record repo before ref network failure"); interruptRef = false
        _ = try await publish(recorded); try check(patches == 3, "interrupted initial repository recovers")
        // Cancel before a request and while native confirmation is open. A
        // cancellation must never continue to create a repository or push.
        let routes = GitHubMock.handler!
        var networkCalls = 0, writes = 0
        GitHubMock.handler = { request in
            networkCalls += 1
            if ["POST", "PATCH", "PUT", "DELETE"].contains(request.httpMethod ?? "") { writes += 1 }
            return try routes(request)
        }
        let alreadyCancelled = Task { @MainActor in
            withUnsafeCurrentTask { $0?.cancel() }
            do { _ = try await api.account(); return false }
            catch { return error is CancellationError }
        }
        try check(await alreadyCancelled.value && networkCalls == 0, "pre-cancelled request never reaches network")
        for old in [nil, repo] as [GitHubFirmware.Repository?] {
            mode = old == nil ? "new" : "update"; marker = old != nil
            var reviewed = false
            let cancelledPublish = Task { @MainActor in
                do {
                    _ = try await api.publish(files: files, keyboard: "test_board", target: "qmk", owner: "tester", name: "board-qmk", isPrivate: true, existing: old, created: { _ in }, progress: { _ in }, confirm: { review in
                        reviewed = review.creating == (old == nil) && !review.changes.isEmpty
                        withUnsafeCurrentTask { $0?.cancel() }
                        return true // Even a late accepted dialog cannot revive a cancelled task.
                    })
                    return false
                } catch { return error is CancellationError }
            }
            try check(await cancelledPublish.value && reviewed && writes == 0, "cancelled create/update confirmation prevents every write")
        }
        for code in [401, 403, 404, 409, 422, 429, 503] {
            status = code
            do { _ = try await api.account(); throw NSError(domain: "ExpectedRejection", code: 0) }
            catch { try check((error as NSError).domain != "ExpectedRejection" && !error.localizedDescription.contains("test-secret"), "sanitized HTTP \(code)") }
        }
        status = 200
        for path in ["../secret", "screenshots/image.png", "keyboards/handwired/other/config.h"] {
            do { try GitHubFirmware.validate(files: files + [.init(path: path, content: "private")], keyboard: "test_board", target: "qmk"); throw NSError(domain: "ExpectedRejection", code: 0) }
            catch { try check((error as NSError).domain != "ExpectedRejection", "upload scope " + path) }
        }
        var conclusion = "success", expired = false, noRuns = false
        GitHubMock.handler = { r in
            if r.url!.path.hasSuffix("/actions/runs") {
                let q = URLComponents(url: r.url!, resolvingAgainstBaseURL: false)!.queryItems!
                try check(q.contains { $0.name == "head_sha" && $0.value == sha }, "SHA query")
                let run: [String: Any] = ["id": 123, "head_sha": sha, "path": ".github/workflows/build.yml", "event": "push", "status": "completed", "conclusion": conclusion]
                let stale: [String: Any] = ["id": 999, "head_sha": head, "path": ".github/workflows/build.yml", "event": "push", "status": "completed", "conclusion": "success"]
                let other: [String: Any] = ["id": 888, "head_sha": sha, "path": ".github/workflows/other.yml", "event": "push", "status": "completed", "conclusion": "success"]
                return try json(["workflow_runs": noRuns ? [] : [run, stale, other]])
            }
            if r.url!.path.hasSuffix("/runs/123/artifacts") { return try json(["artifacts": [["id": 77, "name": "firmware", "expired": expired] as [String: Any]]]) }
            if r.url!.path.hasSuffix("/artifacts/77/zip") { try check(r.value(forHTTPHeaderField: "Authorization") != nil, "artifact API authenticated"); return (302, ["Location": "https://download.example.com/signed.zip"], Data()) }
            if r.url!.host == "download.example.com" { try check(r.value(forHTTPHeaderField: "Authorization") == nil, "signed URL has no token"); return (200, ["Content-Type": "application/zip"], Data([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])) }
            throw GitHubFirmware.problem("Unexpected run route")
        }
        let done = try await api.refresh(job); try check(done.runID == 123 && done.artifactID == 77, "correct workflow and SHA with artifact")
        let zip = try await api.download(done); try check(FileManager.default.fileExists(atPath: zip.path), "artifact saved to temporary file"); try FileManager.default.removeItem(at: zip)
        expired = true; try check(try await api.refresh(job).artifactID == nil, "expired artifact disabled")
        conclusion = "failure"; try check(try await api.refresh(job).conclusion == "failure", "failed build reported")
        noRuns = true; try check(try await api.refresh(job).status == "waiting", "registration delay remains waiting")
        try check(GitHubMock.failures.isEmpty, "mock assertions: " + GitHubMock.failures.joined(separator: "; "))
        print("PASS: \(checks) GitHub checks; private creation, safe update/recovery, cancellation before writes, UTF8/workflow, conflicts, sanitized errors, SHA matching, artifacts, credential-free signed download. No real GitHub or Keychain access.")
    }
}
