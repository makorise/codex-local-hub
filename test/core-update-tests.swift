import Foundation

private var failures = 0
private func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        failures += 1
        fputs("FAIL: \(message)\n", stderr)
    }
}

@main
struct CoreUpdateTests {
    static func main() throws {
        guard CommandLine.arguments.count == 3 else { exit(2) }
        let archive = URL(fileURLWithPath: CommandLine.arguments[1])
        let checksum = CommandLine.arguments[2]
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("CodexCoreTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let suiteName = "CodexCoreTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let store = CoreUpdateStore(hostVersion: "0.2.2", defaults: defaults, applicationSupport: temporary)
        let activation = try store.install(archive: archive, expectedVersion: "0.2.3", expectedSHA256: checksum)
        expect(activation.version == "0.2.3", "installs the expected core version")
        expect(activation.previousDirectoryName == nil, "first hot update has no previous core")
        expect(store.activeServerRoot()?.appendingPathComponent("src/index.mjs").pathExtension == "mjs", "activates an extracted server root")
        expect(store.effectiveVersion() == "0.2.3", "reports the effective core version")

        store.restore(directoryName: nil)
        expect(store.activeServerRoot() == nil, "can atomically restore the bundled core")
        do {
            _ = try store.install(archive: archive, expectedVersion: "0.2.3", expectedSHA256: String(repeating: "0", count: 64))
            expect(false, "rejects a mismatched checksum")
        } catch CoreUpdateError.checksumMismatch { expect(true, "rejects a mismatched checksum") }
        do {
            _ = try store.install(archive: archive, expectedVersion: "9.9.9", expectedSHA256: checksum)
            expect(false, "rejects a mismatched manifest version")
        } catch CoreUpdateError.invalidManifest { expect(true, "rejects a mismatched manifest version") }

        let oldHost = CoreUpdateStore(hostVersion: "0.2.1", defaults: defaults, applicationSupport: temporary.appendingPathComponent("old"))
        do {
            _ = try oldHost.install(archive: archive, expectedVersion: "0.2.3", expectedSHA256: checksum)
            expect(false, "rejects a core that requires a newer host")
        } catch CoreUpdateError.incompatibleHost(let version) { expect(version == "0.2.2", "reports the required host version") }

        let sameVersionHost = CoreUpdateStore(hostVersion: "0.2.3", defaults: defaults, applicationSupport: temporary.appendingPathComponent("same"))
        do {
            _ = try sameVersionHost.install(archive: archive, expectedVersion: "0.2.3", expectedSHA256: checksum)
            expect(false, "rejects reinstalling the same core")
        } catch CoreUpdateError.notNewer { expect(true, "rejects reinstalling the same core") }

        if failures == 0 { print("Core hot-update tests passed") }
        exit(failures == 0 ? 0 : 1)
    }
}
