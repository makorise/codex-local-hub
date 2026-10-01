import Foundation

struct SemanticVersion: Comparable, Equatable, CustomStringConvertible {
    let major: Int
    let minor: Int
    let patch: Int

    init?(_ rawValue: String) {
        var value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.lowercased().hasPrefix("v") { value.removeFirst() }
        let stable = value.split(separator: "+", maxSplits: 1, omittingEmptySubsequences: false)[0]
        guard !stable.contains("-") else { return nil }
        let pieces = stable.split(separator: ".", omittingEmptySubsequences: false)
        guard pieces.count == 3,
              let major = Int(pieces[0]), major >= 0,
              let minor = Int(pieces[1]), minor >= 0,
              let patch = Int(pieces[2]), patch >= 0 else { return nil }
        self.major = major
        self.minor = minor
        self.patch = patch
    }

    var description: String { "\(major).\(minor).\(patch)" }

    static func < (lhs: SemanticVersion, rhs: SemanticVersion) -> Bool {
        if lhs.major != rhs.major { return lhs.major < rhs.major }
        if lhs.minor != rhs.minor { return lhs.minor < rhs.minor }
        return lhs.patch < rhs.patch
    }
}

struct UpdateAsset: Equatable {
    let name: String
    let url: URL
    let sha256: String
}

struct UpdateRelease: Equatable {
    let version: String
    let pageURL: URL
    let coreAsset: UpdateAsset?
    let installerAsset: UpdateAsset?
}

private struct GitHubReleasePayload: Decodable {
    struct Asset: Decodable {
        let name: String
        let browserDownloadURL: URL
        let digest: String?

        enum CodingKeys: String, CodingKey {
            case name
            case browserDownloadURL = "browser_download_url"
            case digest
        }
    }

    let tagName: String
    let htmlURL: URL
    let draft: Bool
    let prerelease: Bool
    let assets: [Asset]

    enum CodingKeys: String, CodingKey {
        case tagName = "tag_name"
        case htmlURL = "html_url"
        case draft
        case prerelease
        case assets
    }
}

enum UpdateCheckResult {
    case available(UpdateRelease)
    case upToDate
    case noRelease
    case skipped(UpdateRelease?)
    case failed(String)
}

final class GitHubUpdateChecker {
    static let checkInterval: TimeInterval = 24 * 60 * 60
    static let defaultEndpoint = URL(string: "https://api.github.com/repos/makorise/codex-local-hub/releases/latest")!
    static let fallbackEndpoint = URL(string: "https://github.com/makorise/codex-local-hub/releases/latest")!

    private enum Key {
        static let checkedAt = "CodexLocalHubUpdateCheckedAt"
        static let version = "CodexLocalHubUpdateVersion"
        static let pageURL = "CodexLocalHubUpdatePageURL"
        static let coreURL = "CodexLocalHubUpdateCoreURL"
        static let coreName = "CodexLocalHubUpdateCoreName"
        static let coreSHA256 = "CodexLocalHubUpdateCoreSHA256"
        static let installerURL = "CodexLocalHubUpdateInstallerURL"
        static let installerName = "CodexLocalHubUpdateInstallerName"
        static let installerSHA256 = "CodexLocalHubUpdateInstallerSHA256"
        static let noStableRelease = "CodexLocalHubNoStableRelease"
    }

    private let currentVersion: SemanticVersion
    private let defaults: UserDefaults
    private let session: URLSession
    private let endpoint: URL
    private let fallbackEndpoint: URL
    private let now: () -> Date

    init(
        currentVersion: String,
        defaults: UserDefaults = .standard,
        session: URLSession = .shared,
        endpoint: URL = GitHubUpdateChecker.defaultEndpoint,
        fallbackEndpoint: URL = GitHubUpdateChecker.fallbackEndpoint,
        now: @escaping () -> Date = Date.init
    ) {
        self.currentVersion = SemanticVersion(currentVersion) ?? SemanticVersion("0.0.0")!
        self.defaults = defaults
        self.session = session
        self.endpoint = endpoint
        self.fallbackEndpoint = fallbackEndpoint
        self.now = now
    }

    static func shouldCheck(lastCheckedAt: Date?, now: Date, force: Bool) -> Bool {
        guard !force, let lastCheckedAt else { return true }
        return now.timeIntervalSince(lastCheckedAt) >= checkInterval
    }

    static func release(from data: Data, currentVersion: SemanticVersion) -> UpdateRelease? {
        guard let payload = try? JSONDecoder().decode(GitHubReleasePayload.self, from: data),
              !payload.draft,
              !payload.prerelease,
              let remoteVersion = SemanticVersion(payload.tagName),
              remoteVersion > currentVersion,
              payload.htmlURL.scheme == "https",
              payload.htmlURL.host == "github.com" else { return nil }

        let coreAsset = trustedAsset(named: "Codex-Local-Hub-core-\(remoteVersion).zip", in: payload.assets)
        let installerAsset = trustedAsset(named: "Codex-Local-Hub-\(remoteVersion)-universal.dmg", in: payload.assets)
        return UpdateRelease(
            version: remoteVersion.description,
            pageURL: payload.htmlURL,
            coreAsset: coreAsset,
            installerAsset: installerAsset
        )
    }

    private static func trustedAsset(named name: String, in assets: [GitHubReleasePayload.Asset]) -> UpdateAsset? {
        guard let asset = assets.first(where: { $0.name == name }),
              asset.browserDownloadURL.scheme == "https",
              asset.browserDownloadURL.host == "github.com",
              let digest = asset.digest,
              digest.hasPrefix("sha256:") else { return nil }
        let sha256 = String(digest.dropFirst("sha256:".count)).lowercased()
        guard sha256.count == 64, sha256.allSatisfy({ $0.isHexDigit }) else { return nil }
        return UpdateAsset(name: asset.name, url: asset.browserDownloadURL, sha256: sha256)
    }

    func cachedUpdate() -> UpdateRelease? {
        guard let version = defaults.string(forKey: Key.version),
              let parsed = SemanticVersion(version),
              parsed > currentVersion,
              let pageValue = defaults.string(forKey: Key.pageURL),
              let pageURL = URL(string: pageValue), pageURL.scheme == "https", pageURL.host == "github.com" else { return nil }
        return UpdateRelease(
            version: parsed.description,
            pageURL: pageURL,
            coreAsset: cachedAsset(urlKey: Key.coreURL, nameKey: Key.coreName, digestKey: Key.coreSHA256),
            installerAsset: cachedAsset(urlKey: Key.installerURL, nameKey: Key.installerName, digestKey: Key.installerSHA256)
        )
    }

    func invalidateCache() {
        defaults.removeObject(forKey: Key.checkedAt)
        defaults.removeObject(forKey: Key.version)
        defaults.removeObject(forKey: Key.pageURL)
        defaults.removeObject(forKey: Key.noStableRelease)
        store(nil, urlKey: Key.coreURL, nameKey: Key.coreName, digestKey: Key.coreSHA256)
        store(nil, urlKey: Key.installerURL, nameKey: Key.installerName, digestKey: Key.installerSHA256)
    }

    func check(force: Bool = false, completion: @escaping (UpdateCheckResult) -> Void) {
        let checkedAt = defaults.object(forKey: Key.checkedAt) as? Date
        guard Self.shouldCheck(lastCheckedAt: checkedAt, now: now(), force: force) else {
            if let cached = cachedUpdate() { completion(.skipped(cached)) }
            else if defaults.bool(forKey: Key.noStableRelease) { completion(.noRelease) }
            else { completion(.skipped(nil)) }
            return
        }

        var request = URLRequest(url: endpoint, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("Codex-Local-Hub/\(currentVersion)", forHTTPHeaderField: "User-Agent")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")

        session.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }
            if let error {
                self.checkFallback(failure: error.localizedDescription, completion: completion)
                return
            }
            guard let response = response as? HTTPURLResponse else {
                self.checkFallback(failure: "Invalid update response", completion: completion)
                return
            }
            guard (200..<300).contains(response.statusCode), let data else {
                self.checkFallback(failure: "GitHub returned HTTP \(response.statusCode)", completion: completion)
                return
            }
            let update = Self.release(from: data, currentVersion: self.currentVersion)
            self.recordSuccessfulCheck(update: update, noStableRelease: false)
            completion(update.map(UpdateCheckResult.available) ?? .upToDate)
        }.resume()
    }

    private func checkFallback(failure: String, completion: @escaping (UpdateCheckResult) -> Void) {
        var request = URLRequest(url: fallbackEndpoint, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.httpMethod = "HEAD"
        request.setValue("Codex-Local-Hub/\(currentVersion)", forHTTPHeaderField: "User-Agent")
        session.dataTask(with: request) { [weak self] _, response, error in
            guard let self else { return }
            guard error == nil, let response = response as? HTTPURLResponse else {
                completion(.failed(failure))
                return
            }
            if response.statusCode == 404 {
                self.recordSuccessfulCheck(update: nil, noStableRelease: true)
                completion(.noRelease)
                return
            }
            guard (200..<300).contains(response.statusCode),
                  let pageURL = response.url,
                  let remoteVersion = Self.fallbackVersion(from: pageURL) else {
                completion(.failed(failure))
                return
            }
            guard remoteVersion > self.currentVersion else {
                self.recordSuccessfulCheck(update: nil, noStableRelease: false)
                completion(.upToDate)
                return
            }
            self.fetchFallbackCore(version: remoteVersion, pageURL: pageURL, completion: completion)
        }.resume()
    }

    private static func fallbackVersion(from url: URL) -> SemanticVersion? {
        let prefix = "/makorise/codex-local-hub/releases/tag/v"
        guard url.scheme == "https", url.host == "github.com", url.path.hasPrefix(prefix) else { return nil }
        let suffix = String(url.path.dropFirst(prefix.count))
        guard !suffix.isEmpty, !suffix.contains("/") else { return nil }
        return SemanticVersion(suffix)
    }

    private func fetchFallbackCore(version: SemanticVersion, pageURL: URL, completion: @escaping (UpdateCheckResult) -> Void) {
        let assetName = "Codex-Local-Hub-core-\(version).zip"
        let base = "https://github.com/makorise/codex-local-hub/releases/download/v\(version)"
        guard let assetURL = URL(string: "\(base)/\(assetName)"),
              let checksumURL = URL(string: "\(base)/\(assetName).sha256") else {
            completion(.failed("Invalid fallback update URL"))
            return
        }
        var request = URLRequest(url: checksumURL, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("Codex-Local-Hub/\(currentVersion)", forHTTPHeaderField: "User-Agent")
        session.dataTask(with: request) { [weak self] data, response, _ in
            guard let self else { return }
            var coreAsset: UpdateAsset?
            if let response = response as? HTTPURLResponse,
               (200..<300).contains(response.statusCode),
               let data,
               let value = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
               let digest = value.split(whereSeparator: { $0.isWhitespace }).first.map(String.init)?.lowercased(),
               digest.count == 64, digest.allSatisfy({ $0.isHexDigit }) {
                coreAsset = UpdateAsset(name: assetName, url: assetURL, sha256: digest)
            }
            let update = UpdateRelease(version: version.description, pageURL: pageURL, coreAsset: coreAsset, installerAsset: nil)
            self.recordSuccessfulCheck(update: update, noStableRelease: false)
            completion(.available(update))
        }.resume()
    }

    private func recordSuccessfulCheck(update: UpdateRelease?, noStableRelease: Bool) {
        defaults.set(now(), forKey: Key.checkedAt)
        defaults.set(noStableRelease, forKey: Key.noStableRelease)
        if let update {
            defaults.set(update.version, forKey: Key.version)
            defaults.set(update.pageURL.absoluteString, forKey: Key.pageURL)
            store(update.coreAsset, urlKey: Key.coreURL, nameKey: Key.coreName, digestKey: Key.coreSHA256)
            store(update.installerAsset, urlKey: Key.installerURL, nameKey: Key.installerName, digestKey: Key.installerSHA256)
        } else {
            defaults.removeObject(forKey: Key.version)
            defaults.removeObject(forKey: Key.pageURL)
            store(nil, urlKey: Key.coreURL, nameKey: Key.coreName, digestKey: Key.coreSHA256)
            store(nil, urlKey: Key.installerURL, nameKey: Key.installerName, digestKey: Key.installerSHA256)
        }
    }

    private func cachedAsset(urlKey: String, nameKey: String, digestKey: String) -> UpdateAsset? {
        guard let urlValue = defaults.string(forKey: urlKey), let url = URL(string: urlValue),
              url.scheme == "https", url.host == "github.com",
              let name = defaults.string(forKey: nameKey), let digest = defaults.string(forKey: digestKey),
              digest.count == 64, digest.allSatisfy({ $0.isHexDigit }) else { return nil }
        return UpdateAsset(name: name, url: url, sha256: digest)
    }

    private func store(_ asset: UpdateAsset?, urlKey: String, nameKey: String, digestKey: String) {
        if let asset {
            defaults.set(asset.url.absoluteString, forKey: urlKey)
            defaults.set(asset.name, forKey: nameKey)
            defaults.set(asset.sha256, forKey: digestKey)
        } else {
            defaults.removeObject(forKey: urlKey)
            defaults.removeObject(forKey: nameKey)
            defaults.removeObject(forKey: digestKey)
        }
    }
}
