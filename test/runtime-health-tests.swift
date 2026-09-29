import Foundation
import Darwin

private var failures = 0
private func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    if !condition() {
        failures += 1
        fputs("FAIL: \(message)\n", stderr)
    }
}

@main
struct RuntimeHealthTests {
    static func main() throws {
        expect(RuntimeHealth.parsePIDs("42\n77\n") == [42, 77], "parses listener PIDs")
        expect(RuntimeHealth.parsePIDs("noise\n") == [], "ignores malformed listener output")
        let parsed = RuntimeHealth.parseProcess(pid: 42, output: "   1 /Applications/Codex Local Hub.app/Contents/Resources/runtime/node-arm64 server\n")
        expect(parsed?.parentPID == 1, "parses a process parent PID")
        expect(parsed?.command.hasSuffix("server") == true, "parses a process command")
        expect(RuntimeHealth.parseProcess(pid: 42, output: "invalid") == nil, "rejects malformed process details")

        let bundle = "/Applications/Codex Local Hub.app"
        let managedCommand = "\(bundle)/Contents/Resources/runtime/node-arm64 \(bundle)/Contents/Resources/server/src/index.mjs"
        expect(RuntimeHealth.isManagedServer(command: managedCommand, bundlePath: bundle), "recognizes the bundled server exactly")
        expect(!RuntimeHealth.isManagedServer(command: "/usr/local/bin/node /tmp/index.mjs", bundlePath: bundle), "does not claim an unrelated Node server")
        expect(RuntimeHealth.safeProcessName("/Applications/Other Tool.app/bin/server --secret value") == "server", "redacts arguments and paths from process names")

        let current = RuntimeHealth(bundlePath: bundle, currentPID: 99, run: { executable, _ in
            executable == "/usr/sbin/lsof" ? (0, "42\n") : (0, "99 \(managedCommand)\n")
        })
        expect(current.inspectPort() == .managedCurrent(RuntimeListener(pid: 42, parentPID: 99, command: managedCommand)), "identifies the current managed server")

        let foreign = RuntimeHealth(bundlePath: bundle, run: { executable, _ in
            executable == "/usr/sbin/lsof" ? (0, "55\n") : (0, "7 /usr/local/bin/python3 private-script.py\n")
        })
        expect(foreign.preparePort() == .blocked("python3"), "never terminates a foreign listener")

        var alive = true
        var sentSignals: [Int32] = []
        let orphan = RuntimeHealth(bundlePath: bundle, run: { executable, _ in
            if executable == "/usr/sbin/lsof" { return alive ? (0, "73\n") : (1, "") }
            return (0, "1 \(managedCommand)\n")
        }, signal: { pid, value in
            expect(pid == 73, "signals only the confirmed orphan")
            sentSignals.append(value)
            alive = false
            return 0
        }, pause: { _ in })
        expect(orphan.preparePort() == .recovered(73), "recovers a confirmed managed orphan")
        expect(sentSignals == [SIGTERM], "uses graceful termination before escalation")

        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("CodexLookoutLock-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        var first: SingleInstanceLock? = SingleInstanceLock.acquire(in: temporary)
        expect(first != nil, "acquires the first app-instance lock")
        expect(SingleInstanceLock.acquire(in: temporary) == nil, "rejects a second app-instance lock")
        first = nil
        expect(SingleInstanceLock.acquire(in: temporary) != nil, "releases the app-instance lock cleanly")

        let report = RuntimeDiagnostics(
            appVersion: "0.2.45",
            coreVersion: "0.2.45",
            serviceOnline: false,
            portState: .foreign(RuntimeListener(pid: 12, parentPID: 1, command: "/Users/alice/private/secret-tool --token hunter2")),
            storedCoreCount: 2,
            codexDataAvailable: true,
            lanAddressAvailable: false
        ).report(chinese: false)
        expect(report.contains("secret-tool"), "keeps a useful redacted process name")
        expect(!report.contains("alice") && !report.contains("hunter2") && !report.contains("/Users"), "diagnostics omit private paths and arguments")
        expect(RuntimeDiagnostics(appVersion: "1", coreVersion: "1", serviceOnline: true, portState: .free, storedCoreCount: 0, codexDataAvailable: false, lanAddressAvailable: true).report(chinese: true).contains("服务：在线"), "localizes diagnostics")

        if failures == 0 { print("Runtime health tests passed") }
        exit(failures == 0 ? 0 : 1)
    }
}
