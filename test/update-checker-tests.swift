import Foundation

private var failures = 0

private final class StubURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (response, data) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }
    override func stopLoading() {}
}

private func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        failures += 1
        fputs("FAIL: \(message)\n", stderr)
    }
}

private func releaseJSON(
    tag: String = "v0.3.0",
    draft: Bool = false,
    prerelease: Bool = false,
    page: String = "https://github.com/makorise/codex-local-hub/releases/tag/v0.3.0",
    includeCore: Bool = true,
    validDigest: Bool = true
) -> Data {
    let digest = validDigest ? String(repeating: "a", count: 64) : "broken"
    let core = includeCore ? "{\"name\":\"Codex-Local-Hub-core-0.3.0.zip\",\"browser_download_url\":\"https://github.com/makorise/codex-local-hub/releases/download/v0.3.0/Codex-Local-Hub-core-0.3.0.zip\",\"digest\":\"sha256:\(digest)\"}," : ""
    return Data("""
    {"tag_name":"\(tag)","html_url":"\(page)","draft":\(draft),"prerelease":\(prerelease),"assets":[\(core){"name":"Codex-Local-Hub-0.3.0-universal.dmg","browser_download_url":"https://github.com/makorise/codex-local-hub/releases/download/v0.3.0/Codex-Local-Hub-0.3.0-universal.dmg","digest":"sha256:\(digest)"}]}
    """.utf8)
}

@main
struct UpdateCheckerTests {
    static func main() {
        let current = SemanticVersion("0.2.1")!
        expect(SemanticVersion("v1.2.3") == SemanticVersion("1.2.3+7"), "normalizes stable versions")
        expect(SemanticVersion("1.2.4")! > SemanticVersion("1.2.3")!, "compares patch versions")
        expect(SemanticVersion("1.3.0")! > SemanticVersion("1.2.99")!, "compares minor versions")
        expect(SemanticVersion("2.0.0")! > SemanticVersion("1.99.99")!, "compares major versions")
        expect(SemanticVersion("1.2") == nil, "rejects incomplete versions")
        expect(SemanticVersion("1.2.3-beta") == nil, "rejects prerelease versions")
        expect(SemanticVersion("broken") == nil, "rejects invalid versions")

        let update = GitHubUpdateChecker.release(from: releaseJSON(), currentVersion: current)
        expect(update?.version == "0.3.0", "accepts a newer stable release")
        expect(update?.coreAsset?.name == "Codex-Local-Hub-core-0.3.0.zip", "selects the expected hot-update core")
        expect(update?.installerAsset?.name == "Codex-Local-Hub-0.3.0-universal.dmg", "selects the expected universal DMG")
        expect(update?.coreAsset?.url.host == "github.com", "keeps downloads on GitHub")
        expect(GitHubUpdateChecker.release(from: releaseJSON(tag: "v0.2.1"), currentVersion: current) == nil, "does not reinstall the same version")
        expect(GitHubUpdateChecker.release(from: releaseJSON(tag: "v0.1.9"), currentVersion: current) == nil, "does not downgrade")
        expect(GitHubUpdateChecker.release(from: releaseJSON(draft: true), currentVersion: current) == nil, "ignores draft releases")
        expect(GitHubUpdateChecker.release(from: releaseJSON(prerelease: true), currentVersion: current) == nil, "ignores prereleases")
        expect(GitHubUpdateChecker.release(from: releaseJSON(page: "http://example.com/release"), currentVersion: current) == nil, "rejects untrusted release pages")

        let fallback = GitHubUpdateChecker.release(from: releaseJSON(includeCore: false), currentVersion: current)
        expect(fallback?.coreAsset == nil, "falls back to the installer without the exact core archive")
        let untrusted = GitHubUpdateChecker.release(from: releaseJSON(validDigest: false), currentVersion: current)
        expect(untrusted?.coreAsset == nil && untrusted?.installerAsset == nil, "rejects assets without a trusted SHA-256 digest")
        let now = Date(timeIntervalSince1970: 2_000_000)
        expect(GitHubUpdateChecker.shouldCheck(lastCheckedAt: nil, now: now, force: false), "checks on first launch")
        expect(!GitHubUpdateChecker.shouldCheck(lastCheckedAt: now.addingTimeInterval(-60), now: now, force: false), "throttles recent automatic checks")
        expect(GitHubUpdateChecker.shouldCheck(lastCheckedAt: now.addingTimeInterval(-GitHubUpdateChecker.checkInterval), now: now, force: false), "checks again after one day")
        expect(GitHubUpdateChecker.shouldCheck(lastCheckedAt: now, now: now, force: true), "manual checks bypass throttling")

        let suiteName = "CodexLocalHubUpdateTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let endpoint = URL(string: "https://api.github.com/repos/test/releases/latest")!
        var requestCount = 0
        StubURLProtocol.handler = { request in
            requestCount += 1
            expect(request.value(forHTTPHeaderField: "User-Agent") == "Codex-Local-Hub/0.2.1", "sends an explicit GitHub user agent")
            return (HTTPURLResponse(url: endpoint, statusCode: 200, httpVersion: nil, headerFields: nil)!, releaseJSON())
        }
        let checker = GitHubUpdateChecker(currentVersion: "0.2.1", defaults: defaults, session: session, endpoint: endpoint, now: { now })
        let first = waitForCheck(checker)
        if case .available(let release) = first { expect(release.version == "0.3.0", "network check returns the available update") }
        else { expect(false, "network check should return an available update") }
        expect(checker.cachedUpdate()?.version == "0.3.0", "persists a discovered update")
        if case .skipped(let cached) = waitForCheck(checker) { expect(cached?.version == "0.3.0", "returns the cached update during the daily throttle") }
        else { expect(false, "second automatic check should be throttled") }
        expect(requestCount == 1, "performs at most one request during the daily interval")

        StubURLProtocol.handler = { _ in
            (HTTPURLResponse(url: endpoint, statusCode: 404, httpVersion: nil, headerFields: nil)!, Data())
        }
        if case .noRelease = waitForCheck(checker, force: true) { expect(true, "404 means there is no published stable release") }
        else { expect(false, "404 should be shown as no published stable release") }
        expect(checker.cachedUpdate() == nil, "clears a stale cached update after a successful no-release response")
        if case .noRelease = waitForCheck(checker) { expect(true, "remembers the no-release state during the daily throttle") }
        else { expect(false, "throttled checks should preserve the no-release state") }

        StubURLProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        if case .failed = waitForCheck(checker, force: true) { expect(true, "offline failures are reported without changing versions") }
        else { expect(false, "offline check should fail safely") }

        if failures == 0 { print("Update checker tests passed") }
        exit(failures == 0 ? 0 : 1)
    }

    private static func waitForCheck(_ checker: GitHubUpdateChecker, force: Bool = false) -> UpdateCheckResult {
        let semaphore = DispatchSemaphore(value: 0)
        var result: UpdateCheckResult = .failed("timeout")
        checker.check(force: force) {
            result = $0
            semaphore.signal()
        }
        _ = semaphore.wait(timeout: .now() + 3)
        return result
    }
}
