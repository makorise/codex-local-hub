import Foundation
import CryptoKit

struct CoreManifest: Decodable, Equatable {
    let schemaVersion: Int
    let version: String
    let minimumHostVersion: String
}

struct CoreActivation {
    let version: String
    let directoryName: String
    let previousDirectoryName: String?
}

enum CoreUpdateError: LocalizedError {
    case checksumMismatch
    case unsafeArchive
    case invalidManifest
    case notNewer
    case incompatibleHost(String)
    case extractionFailed(String)

    var errorDescription: String? {
        switch self {
        case .checksumMismatch: return "The core update checksum did not match."
        case .unsafeArchive: return "The core update archive contains unsafe paths."
        case .invalidManifest: return "The core update manifest is invalid."
        case .notNewer: return "The core update is not newer than the active version."
        case .incompatibleHost(let version): return "The core update requires host version \(version) or newer."
        case .extractionFailed(let message): return "Could not extract the core update: \(message)"
        }
    }
}

final class CoreUpdateStore {
    private static let activeDirectoryKey = "CodexLocalHubActiveCoreDirectory"
    private static let previousDirectoryKey = "CodexLocalHubPreviousCoreDirectory"

    private let hostVersion: SemanticVersion
    private let defaults: UserDefaults
    private let root: URL

    init(
        hostVersion: String,
        defaults: UserDefaults = .standard,
        applicationSupport: URL? = nil
    ) {
        self.hostVersion = SemanticVersion(hostVersion) ?? SemanticVersion("0.0.0")!
        self.defaults = defaults
        let support = applicationSupport ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        self.root = support.appendingPathComponent("Codex Local Hub/CoreUpdates", isDirectory: true)
    }

    func effectiveVersion() -> String {
        guard let manifest = activeManifest(), let coreVersion = SemanticVersion(manifest.version), coreVersion > hostVersion else {
            return hostVersion.description
        }
        return coreVersion.description
    }

    func activeServerRoot() -> URL? {
        guard let directory = activeDirectory(),
              let manifest = validatedManifest(at: directory),
              let coreVersion = SemanticVersion(manifest.version),
              coreVersion > hostVersion else {
            defaults.removeObject(forKey: Self.activeDirectoryKey)
            return nil
        }
        return directory
    }

    @discardableResult
    func pruneStoredVersions() -> Int {
        let activeName = validStoredDirectoryName(defaults.string(forKey: Self.activeDirectoryKey))
        let previousName = validStoredDirectoryName(defaults.string(forKey: Self.previousDirectoryKey))
        let keep = Set([activeName, previousName].compactMap { $0 })
        if activeName == nil { defaults.removeObject(forKey: Self.activeDirectoryKey) }
        if previousName == nil { defaults.removeObject(forKey: Self.previousDirectoryKey) }
        return pruneVersions(keeping: keep)
    }

    func storedVersionCount() -> Int {
        storedDirectoryNames().count
    }

    func install(archive: URL, expectedVersion: String, expectedSHA256: String) throws -> CoreActivation {
        guard verify(file: archive, expectedSHA256: expectedSHA256) else { throw CoreUpdateError.checksumMismatch }
        try validateArchivePaths(archive)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let staging = root.appendingPathComponent("staging-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: staging) }
        let extraction = try run("/usr/bin/ditto", ["-x", "-k", archive.path, staging.path])
        guard extraction.status == 0 else { throw CoreUpdateError.extractionFailed(extraction.output) }
        guard let manifest = validatedManifest(at: staging), manifest.schemaVersion == 1,
              manifest.version == expectedVersion,
              let targetVersion = SemanticVersion(manifest.version),
              let minimumHost = SemanticVersion(manifest.minimumHostVersion) else { throw CoreUpdateError.invalidManifest }
        guard hostVersion >= minimumHost else { throw CoreUpdateError.incompatibleHost(minimumHost.description) }
        guard let installedVersion = SemanticVersion(effectiveVersion()), targetVersion > installedVersion else { throw CoreUpdateError.notNewer }

        let versions = root.appendingPathComponent("versions", isDirectory: true)
        try FileManager.default.createDirectory(at: versions, withIntermediateDirectories: true)
        var directoryName = manifest.version
        var destination = versions.appendingPathComponent(directoryName, isDirectory: true)
        if FileManager.default.fileExists(atPath: destination.path) {
            directoryName = "\(manifest.version)-\(Int(Date().timeIntervalSince1970))"
            destination = versions.appendingPathComponent(directoryName, isDirectory: true)
        }
        try FileManager.default.moveItem(at: staging, to: destination)
        let previous = validStoredDirectoryName(defaults.string(forKey: Self.activeDirectoryKey))
        defaults.set(directoryName, forKey: Self.activeDirectoryKey)
        if let previous { defaults.set(previous, forKey: Self.previousDirectoryKey) }
        else { defaults.removeObject(forKey: Self.previousDirectoryKey) }
        _ = pruneVersions(keeping: Set([directoryName, previous].compactMap { $0 }))
        return CoreActivation(version: manifest.version, directoryName: directoryName, previousDirectoryName: previous)
    }

    func restore(directoryName: String?) {
        if let directoryName { defaults.set(directoryName, forKey: Self.activeDirectoryKey) }
        else { defaults.removeObject(forKey: Self.activeDirectoryKey) }
        defaults.removeObject(forKey: Self.previousDirectoryKey)
        _ = pruneStoredVersions()
    }

    func complete(_ activation: CoreActivation) {
        let keep = Set([activation.directoryName, activation.previousDirectoryName].compactMap { $0 })
        _ = pruneVersions(keeping: keep)
    }

    func rollback(_ activation: CoreActivation) {
        if let previous = activation.previousDirectoryName {
            defaults.set(previous, forKey: Self.activeDirectoryKey)
        } else {
            defaults.removeObject(forKey: Self.activeDirectoryKey)
        }
        defaults.removeObject(forKey: Self.previousDirectoryKey)
        _ = pruneVersions(keeping: Set([activation.previousDirectoryName].compactMap { $0 }))
    }

    func verify(file: URL, expectedSHA256: String) -> Bool {
        sha256(of: file) == expectedSHA256.lowercased()
    }

    private func activeDirectory() -> URL? {
        guard let name = defaults.string(forKey: Self.activeDirectoryKey),
              !name.contains("/"), !name.contains("..") else { return nil }
        return root.appendingPathComponent("versions/\(name)", isDirectory: true)
    }

    private func activeManifest() -> CoreManifest? {
        guard let directory = activeDirectory() else { return nil }
        return validatedManifest(at: directory)
    }

    private func validStoredDirectoryName(_ name: String?) -> String? {
        guard let name, !name.contains("/"), !name.contains("..") else { return nil }
        let directory = root.appendingPathComponent("versions/\(name)", isDirectory: true)
        guard let manifest = validatedManifest(at: directory),
              let version = SemanticVersion(manifest.version), version > hostVersion else { return nil }
        return name
    }

    private func storedDirectoryNames() -> [String] {
        let versions = root.appendingPathComponent("versions", isDirectory: true)
        return (try? FileManager.default.contentsOfDirectory(atPath: versions.path)) ?? []
    }

    private func pruneVersions(keeping names: Set<String>) -> Int {
        let versions = root.appendingPathComponent("versions", isDirectory: true)
        var removed = 0
        for name in storedDirectoryNames() where !names.contains(name) {
            guard !name.contains("/"), !name.contains("..") else { continue }
            if (try? FileManager.default.removeItem(at: versions.appendingPathComponent(name, isDirectory: true))) != nil {
                removed += 1
            }
        }
        return removed
    }

    private func validatedManifest(at directory: URL) -> CoreManifest? {
        let manifestURL = directory.appendingPathComponent("core-manifest.json")
        let src = directory.appendingPathComponent("src/index.mjs")
        let page = directory.appendingPathComponent("public/index.html")
        guard FileManager.default.fileExists(atPath: src.path),
              FileManager.default.fileExists(atPath: page.path),
              let data = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONDecoder().decode(CoreManifest.self, from: data),
              SemanticVersion(manifest.version) != nil,
              SemanticVersion(manifest.minimumHostVersion) != nil else { return nil }
        return manifest
    }

    private func validateArchivePaths(_ archive: URL) throws {
        let listing = try run("/usr/bin/zipinfo", ["-1", archive.path])
        guard listing.status == 0 else { throw CoreUpdateError.unsafeArchive }
        let paths = listing.output.split(whereSeparator: \.isNewline).map(String.init)
        guard !paths.isEmpty else { throw CoreUpdateError.unsafeArchive }
        for path in paths {
            let components = path.split(separator: "/", omittingEmptySubsequences: false)
            let allowed = path == "core-manifest.json" || path.hasPrefix("src/") || path.hasPrefix("public/")
            if !allowed || path.hasPrefix("/") || path.contains("\\") || components.contains("..") {
                throw CoreUpdateError.unsafeArchive
            }
        }
    }

    private func sha256(of file: URL) -> String? {
        guard let handle = try? FileHandle(forReadingFrom: file) else { return nil }
        defer { try? handle.close() }
        var hash = SHA256()
        while let data = try? handle.read(upToCount: 1024 * 1024), !data.isEmpty { hash.update(data: data) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func run(_ executable: String, _ arguments: [String]) throws -> (status: Int32, output: String) {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (process.terminationStatus, String(data: data, encoding: .utf8) ?? "")
    }
}
