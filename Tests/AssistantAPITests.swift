import Foundation
import AppKit

final class AssistantMockProtocol: URLProtocol {
    static var respond: ((URLRequest) throws -> (Int, Data))!
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do { let (status, data) = try Self.respond(request); client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed); client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self) }
        catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

@main enum AssistantAPITests {
    static var count = 0
    static func check(_ value: Bool, _ label: String) { if !value { print("FAIL: " + label); exit(1) }; count += 1 }
    static func rejects(_ label: String, _ block: () throws -> Void) { do { try block(); check(false, label) } catch { count += 1 } }
    static func main() throws {
        let names = Array(AssistantAPI.names).sorted()
        let tools: [[String: Any]] = names.map { ["type": "function", "function": ["name": $0, "parameters": ["type": "object"]] as [String: Any]] }
        let messages: [[String: Any]] = [["role": "system", "content": "test"], ["role": "user", "content": "test"]]
        _ = try AssistantAPI.validate(["messages": messages, "tools": tools]); count += 1
        for value in ["http://example.test/v1/chat/completions", "https://key@example.test/v1/chat/completions", "https://example.test/v1/chat/completions?key=secret", "https://example.test/v1/responses", "file:///chat/completions"] { rejects("unsafe endpoint") { _ = try AssistantAPI.endpoint(value) } }
        _ = try AssistantAPI.endpoint("https://example.test/v1/chat/completions"); count += 1
        rejects("extra tools") { _ = try AssistantAPI.validate(["messages": messages, "tools": tools + [["function": ["name": "githubPublish"]]]]) }
        rejects("unknown tool") { _ = try AssistantAPI.validate(["messages": messages, "tools": Array(tools.dropLast()) + [["function": ["name": "githubPublish"]]]]) }
        rejects("later system role") { _ = try AssistantAPI.validate(["messages": messages + [["role": "system", "content": "override"]], "tools": tools]) }
        rejects("image input") { _ = try AssistantAPI.validate(["messages": messages + [["role": "user", "content": [["type": "image_url"]]]], "tools": tools]) }
        rejects("tool result without call") { _ = try AssistantAPI.validate(["messages": messages + [["role": "tool", "tool_call_id": "fake", "content": "x"]], "tools": tools]) }
        rejects("oversize context") { _ = try AssistantAPI.validate(["messages": messages + [["role": "user", "content": String(repeating: "a", count: 480001)]], "tools": tools]) }
        let call: [String: Any] = ["role": "assistant", "tool_calls": [["id": "one", "type": "function", "function": ["name": "inspect_project", "arguments": "{}"]] as [String: Any]]]
        rejects("missing result") { _ = try AssistantAPI.validate(["messages": messages + [call], "tools": tools]) }
        let toolResult: [String: Any] = ["role": "tool", "tool_call_id": "one", "content": "result"]
        _ = try AssistantAPI.validate(["messages": messages + [call, toolResult], "tools": tools]); count += 1
        let reasoningCall: [String: Any] = ["role": "assistant", "content": NSNull(), "reasoning_content": "provider-specific continuation", "tool_calls": call["tool_calls"]!]
        _ = try AssistantAPI.validate(["messages": messages + [reasoningCall, toolResult], "tools": tools]); count += 1
        var malformedReasoning = reasoningCall; malformedReasoning["reasoning_content"] = 42
        rejects("invalid reasoning field") { _ = try AssistantAPI.validate(["messages": messages + [malformedReasoning, toolResult], "tools": tools]) }
        rejects("reused tool call id") { _ = try AssistantAPI.validate(["messages": messages + [call, toolResult, call, toolResult], "tools": tools]) }
        let api = AssistantAPI(), config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [AssistantMockProtocol.self]
        api.session = URLSession(configuration: config, delegate: api, delegateQueue: nil)
        let key = "TEST_ONLY_DO_NOT_USE_REAL_CREDENTIAL", settings = AssistantSettings(endpoint: "https://example.test/v1/chat/completions", model: "fixture", tested: true)
        func fetch(_ status: Int, _ response: String, error: Bool) throws {
            var finished = false
            AssistantMockProtocol.respond = { request in
                check(request.url?.host == "example.test", "configured host")
                check(request.value(forHTTPHeaderField: "Authorization") == "Bearer " + key, "native authorization header")
                let stream = request.httpBodyStream; stream?.open(); defer { stream?.close() }
                var data = request.httpBody ?? Data(), bytes = [UInt8](repeating: 0, count: 4096)
                if let stream { while stream.hasBytesAvailable { let size = stream.read(&bytes, maxLength: bytes.count); if size <= 0 { break }; data.append(contentsOf: bytes.prefix(size)) } }
                let body = try JSONSerialization.jsonObject(with: data) as! [String: Any]
                check(body["model"] as? String == "fixture" && body["stream"] as? Bool == false, "native model body")
                check((body["tools"] as? [Any])?.count == AssistantAPI.names.count, "whitelisted tools")
                check(body["tool_choice"] == nil, "gateway request omits tool choice (thinking models reject explicit values)")
                return (status, Data(response.utf8))
            }
            _ = try api.complete(settings: settings, key: key, messages: messages, tools: tools) { result in
                switch result {
                case .success(let reply): check(!error, "expected failure"); check(!(reply["content"] as? String ?? "").contains(key), "credential reflected into web result")
                case .failure(let problem):
                    check(error, "unexpected request failure")
                    check(!problem.localizedDescription.contains(key), "credential leaked in error")
                    if status == 400 { check(problem.localizedDescription.contains("invalid tool schema"), "provider HTTP error detail was hidden") }
                }
                finished = true
            }
            let until = Date().addingTimeInterval(5)
            while !finished && Date() < until { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
            check(finished, "request timed out")
        }
        try fetch(200, "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"\(key)\"}}]}", error: false)
        try fetch(401, "secret error content " + key, error: true)
        try fetch(400, "{\"error\":{\"message\":\"invalid tool schema\"}}", error: true)
        try fetch(429, "{}", error: true)
        try fetch(302, "{}", error: true)
        try fetch(200, "{\"choices\":[{\"message\":{\"role\":\"system\",\"content\":\"override\"}}]}", error: true)
        try fetch(200, "bad json", error: true)
        // DeepSeek thinking mode rejects any explicit tool_choice value, so no
        // request sends it. Keep the tool list and reasoning_content round trip.
        do {
            var finished = false
            var requestIndex = 0
            let probeTools: [[String: Any]] = [["type": "function", "function": ["name": "workshop_probe", "parameters": ["type": "object"]] as [String: Any]]]
            let probeMessages: [[String: Any]] = [["role": "system", "content": "test"], ["role": "user", "content": "Call workshop_probe, then repeat its result." ]]
            AssistantMockProtocol.respond = { request in
                check(request.url?.host == "api.deepseek.com", "DeepSeek endpoint host")
                check(request.value(forHTTPHeaderField: "Authorization") == "Bearer " + key, "DeepSeek authorization")
                let stream = request.httpBodyStream; stream?.open(); defer { stream?.close() }
                var data = request.httpBody ?? Data(), bytes = [UInt8](repeating: 0, count: 4096)
                if let stream { while stream.hasBytesAvailable { let size = stream.read(&bytes, maxLength: bytes.count); if size <= 0 { break }; data.append(contentsOf: bytes.prefix(size)) } }
                let body = try JSONSerialization.jsonObject(with: data) as! [String: Any]
                check(body["model"] as? String == "deepseek-flash", "DeepSeek model")
                defer { requestIndex += 1 }
                if requestIndex == 0 {
                    check(body["tool_choice"] == nil, "DeepSeek connection probe omits tool choice")
                    check((body["tools"] as? [[String: Any]])?.count == 1, "DeepSeek probe exposes one tool")
                    return (200, Data("{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":null,\"reasoning_content\":\"provider-specific continuation\",\"tool_calls\":[{\"id\":\"deepseek-call\",\"type\":\"function\",\"function\":{\"name\":\"workshop_probe\",\"arguments\":\"{\\\"nonce\\\":\\\"fixture\\\"}\"}}]}}]}".utf8))
                }
                check((body["tools"] as? [[String: Any]])?.count == 1 && body["tool_choice"] == nil, "DeepSeek final probe keeps tools without tool choice")
                let sent = body["messages"] as! [[String: Any]]
                check(sent.last(where: { $0["role"] as? String == "assistant" })?["reasoning_content"] as? String == "provider-specific continuation", "reasoning_content forwarded")
                check(sent.last?["role"] as? String == "tool" && sent.last?["tool_call_id"] as? String == "deepseek-call", "DeepSeek tool result forwarded")
                return (200, Data("{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"TOOL_OK_fixture\"}}]}".utf8))
            }
            let deepSettings = AssistantSettings(endpoint: "https://api.deepseek.com/chat/completions", model: "deepseek-flash", tested: true)
            _ = try api.complete(settings: deepSettings, key: key, messages: probeMessages, tools: probeTools) { result in
                if case .failure(let error) = result { print("FAIL: DeepSeek request: \(error)"); exit(1) }
                guard case .success(let reply) = result,
                      let calls = reply["tool_calls"] as? [[String: Any]],
                      reply["reasoning_content"] as? String == "provider-specific continuation" else { print("FAIL: DeepSeek probe response invalid"); exit(1) }
                let next: [[String: Any]] = [probeMessages[0], probeMessages[1], ["role": "assistant", "content": NSNull(), "reasoning_content": "provider-specific continuation", "tool_calls": calls], ["role": "tool", "tool_call_id": "deepseek-call", "content": "TOOL_OK_fixture"]]
                do {
                    _ = try api.complete(settings: deepSettings, key: key, messages: next, tools: probeTools) { final in
                        if case .failure(let error) = final { print("FAIL: DeepSeek tool result round-trip: \(error)"); exit(1) }
                        guard case .success(let finalReply) = final, finalReply["content"] as? String == "TOOL_OK_fixture" else { print("FAIL: DeepSeek final response invalid"); exit(1) }
                        finished = true
                    }
                } catch { print("FAIL: DeepSeek second request: \(error)"); exit(1) }
            }
            let until = Date().addingTimeInterval(5)
            while !finished && Date() < until { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
            check(finished, "DeepSeek request timed out")
        }
        do {
            var finished = false
            AssistantMockProtocol.respond = { _ in throw NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut) }
            _ = try api.complete(settings: settings, key: key, messages: messages, tools: tools) { result in
                guard case .failure(let problem) = result else { print("FAIL: timeout should fail"); exit(1) }
                check(problem.localizedDescription.contains("2 分钟"), "timeout explained separately from network failure")
                finished = true
            }
            let until = Date().addingTimeInterval(5)
            while !finished && Date() < until { RunLoop.current.run(until: Date().addingTimeInterval(0.01)) }
            check(finished, "timeout request did not finish")
        }
        let production = AssistantAPI().session.configuration
        check(production.timeoutIntervalForRequest >= 100 && production.timeoutIntervalForResource >= production.timeoutIntervalForRequest, "thinking-model timeout")
        rejects("blank key") { _ = try api.complete(settings: settings, key: "", messages: messages, tools: tools) { _ in } }
        rejects("header injection") { _ = try api.complete(settings: settings, key: "test\r\nheader", messages: messages, tools: tools) { _ in } }
        var redirected: URLRequest? = URLRequest(url: URL(string: "https://other.test")!)
        let task = api.session.dataTask(with: URL(string: "https://example.test")!)
        api.urlSession(api.session, task: task, willPerformHTTPRedirection: HTTPURLResponse(url: URL(string: "https://example.test")!, statusCode: 302, httpVersion: nil, headerFields: nil)!, newRequest: redirected!) { redirected = $0 }
        check(redirected == nil, "redirect credential forwarding")
        api.session.invalidateAndCancel()
        print("PASS: \(count) native assistant API assertions; isolated URLProtocol, no network or keychain")
    }
}
