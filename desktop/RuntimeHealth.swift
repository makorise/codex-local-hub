import Foundation
import Darwin

@_silgen_name("flock")
private func systemFlock(_ descriptor: Int32, _ operation: Int32) -> Int32

final class SingleInstanceLock {
    private let descriptor: Int32

    private init(descriptor: Int32) {
        self.descriptor = descriptor
    }

    static func acquire(in directory: URL) -> SingleInstanceLock? {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        } catch {
            return nil
        }
        let path = directory.appendingPathComponent("runtime.lock").path
        let descriptor = Darwin.open(path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { return nil }
        guard systemFlock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
            Darwin.close(descriptor)
            return nil
        }
        return SingleInstanceLock(descriptor: descriptor)
    }

    deinit {
        _ = systemFlock(descriptor, LOCK_UN)
        Darwin.close(descriptor)
    }
}

struct RuntimeListener: Equatable {
    let pid: Int32
    let parentPID: Int32
    let command: String
}

enum RuntimePortState: Equatable {
    case free
    case managedOrphan(RuntimeListener)
    case managedCurrent(RuntimeListener)
    case managedByAnotherHost(RuntimeListener)
    case foreign(RuntimeListener)
    case unknown(Int32)
}

enum RuntimePortPreparation: Equatable {
    case ready
    case recovered(Int32)
    case blocked(String)
}

struct RuntimeDiagnostics {
    let appVersion: String
    let coreVersion: String
    let serviceOnline: Bool
    let portState: RuntimePortState
    let storedCoreCount: Int
    let codexDataAvailable: Bool
    let lanAddressAvailable: Bool

    func report(chinese: Bool) -> String {
        let port: String
        switch portState {
        case .free:
            port = chinese ? "空闲" : "free"
        case .managedOrphan:
            port = chinese ? "发现旧服务" : "stale Lookout service found"
        case .managedCurrent:
            port = chinese ? "由当前瞭望台使用" : "owned by this Lookout instance"
        case .managedByAnotherHost:
            port = chinese ? "由另一个瞭望台进程使用" : "used by another Lookout process"
        case .foreign(let listener):
            let name = RuntimeHealth.safeProcessName(listener.command)
            port = chinese ? "被其他程序占用（\(name)）" : "used by another app (\(name))"
        case .unknown:
            port = chinese ? "状态未知" : "status unknown"
        }
        let yes = chinese ? "可用" : "available"
        let no = chinese ? "不可用" : "unavailable"
        let lines = chinese ? [
            "Codex 瞭望台诊断",
            "宿主版本：v\(appVersion)",
            "核心版本：v\(coreVersion)",
            "服务：\(serviceOnline ? "在线" : "离线")",
            "端口 8787：\(port)",
            "Codex 数据：\(codexDataAvailable ? yes : no)",
            "局域网地址：\(lanAddressAvailable ? yes : no)",
            "保留核心：\(storedCoreCount)",
        ] : [
            "Codex Lookout diagnostics",
            "Host version: v\(appVersion)",
            "Core version: v\(coreVersion)",
            "Service: \(serviceOnline ? "online" : "offline")",
            "Port 8787: \(port)",
            "Codex data: \(codexDataAvailable ? yes : no)",
            "LAN address: \(lanAddressAvailable ? yes : no)",
            "Stored cores: \(storedCoreCount)",
        ]
        return lines.joined(separator: "\n")
    }
}

final class RuntimeHealth {
    typealias CommandRunner = (_ executable: String, _ arguments: [String]) -> (status: Int32, output: String)
    typealias SignalSender = (_ pid: Int32, _ signal: Int32) -> Int32
    typealias Pause = (_ microseconds: useconds_t) -> Void

    private let bundlePath: String
    private let currentPID: Int32
    private let run: CommandRunner
    private let signal: SignalSender
    private let pause: Pause

    init(
        bundlePath: String,
        currentPID: Int32 = ProcessInfo.processInfo.processIdentifier,
        run: @escaping CommandRunner = RuntimeHealth.runCommand,
        signal: @escaping SignalSender = { Darwin.kill($0, $1) },
        pause: @escaping Pause = { Darwin.usleep($0) }
    ) {
        self.bundlePath = bundlePath
        self.currentPID = currentPID
        self.run = run
        self.signal = signal
        self.pause = pause
    }

    func inspectPort(_ port: Int = 8787) -> RuntimePortState {
        let listener = run("/usr/sbin/lsof", ["-nP", "-t", "-iTCP:\(port)", "-sTCP:LISTEN"])
        let pids = RuntimeHealth.parsePIDs(listener.output)
        guard let pid = pids.first else { return .free }
        let details = run("/bin/ps", ["-o", "ppid=", "-o", "command=", "-p", "\(pid)"])
        guard details.status == 0, let process = RuntimeHealth.parseProcess(pid: pid, output: details.output) else {
            return .unknown(pid)
        }
        if RuntimeHealth.isManagedServer(command: process.command, bundlePath: bundlePath) {
            if process.parentPID == 1 { return .managedOrphan(process) }
            if process.parentPID != currentPID { return .managedByAnotherHost(process) }
            return .managedCurrent(process)
        }
        return .foreign(process)
    }

    func preparePort(_ port: Int = 8787) -> RuntimePortPreparation {
        switch inspectPort(port) {
        case .free:
            return .ready
        case .managedOrphan(let listener):
            guard signal(listener.pid, SIGTERM) == 0 else {
                return .blocked("stale Lookout service")
            }
            if waitUntilFree(port) { return .recovered(listener.pid) }
            _ = signal(listener.pid, SIGKILL)
            return waitUntilFree(port) ? .recovered(listener.pid) : .blocked("stale Lookout service")
        case .managedByAnotherHost:
            return .blocked("another Codex Lookout instance")
        case .managedCurrent:
            return .blocked("current Codex Lookout instance")
        case .foreign(let listener):
            return .blocked(RuntimeHealth.safeProcessName(listener.command))
        case .unknown:
            return .blocked("unknown process")
        }
    }

    private func waitUntilFree(_ port: Int) -> Bool {
        for _ in 0..<20 {
            pause(100_000)
            if case .free = inspectPort(port) { return true }
        }
        return false
    }

    static func parsePIDs(_ output: String) -> [Int32] {
        output.split(whereSeparator: \.isNewline).compactMap {
            Int32($0.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }

    static func parseProcess(pid: Int32, output: String) -> RuntimeListener? {
        let value = output.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let separator = value.firstIndex(where: { $0 == " " || $0 == "\t" }),
              let parent = Int32(value[..<separator].trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        let command = value[separator...].trimmingCharacters(in: .whitespacesAndNewlines)
        guard !command.isEmpty else { return nil }
        return RuntimeListener(pid: pid, parentPID: parent, command: command)
    }

    static func isManagedServer(command: String, bundlePath: String) -> Bool {
        command.contains(bundlePath + "/Contents/Resources/runtime/node-") &&
            command.contains(bundlePath + "/Contents/Resources/server/src/index.mjs")
    }

    static func safeProcessName(_ command: String) -> String {
        if let appBoundary = command.range(of: ".app/") {
            let remainder = command[appBoundary.upperBound...]
            let executable = remainder.split(whereSeparator: { $0 == " " || $0 == "\t" }).first.map(String.init) ?? "process"
            let name = URL(fileURLWithPath: executable).lastPathComponent
            return name.isEmpty ? "process" : String(name.prefix(40))
        }
        let executable = command.split(whereSeparator: { $0 == " " || $0 == "\t" }).first.map(String.init) ?? "process"
        let name = URL(fileURLWithPath: executable).lastPathComponent
        return name.isEmpty ? "process" : String(name.prefix(40))
    }

    private static func runCommand(_ executable: String, _ arguments: [String]) -> (status: Int32, output: String) {
        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        process.standardOutput = pipe
        process.standardError = pipe
        do {
            try process.run()
        } catch {
            return (127, "")
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (process.terminationStatus, String(decoding: data, as: UTF8.self))
    }
}
