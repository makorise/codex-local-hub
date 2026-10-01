import Foundation

@main
struct ServerEnvironmentTests {
    static func main() {
        let source = [
            "HOME": "/Users/example",
            "PATH": "/Volumes/External/toolchain/bin:/usr/local/bin:/usr/bin",
            "JAVA_HOME": "/Volumes/External/jdk",
            "SAFE_SETTING": "enabled",
            "CODEX_APP_TOOLS_PIPE_PATH": "/tmp/stale.sock",
            "CODEX_THREAD_ID": "old-thread",
        ]
        let sanitized = ServerEnvironment.sanitized(source)
        precondition(sanitized["HOME"] == "/Users/example")
        precondition(sanitized["SAFE_SETTING"] == "enabled")
        precondition(sanitized["PATH"] == "/usr/local/bin:/usr/bin")
        precondition(sanitized["JAVA_HOME"] == nil)
        precondition(sanitized["CODEX_APP_TOOLS_PIPE_PATH"] == nil)
        precondition(sanitized["CODEX_THREAD_ID"] == nil)

        let fallback = ServerEnvironment.sanitized(["PATH": "/Volumes/External/bin"])
        precondition(fallback["PATH"] == "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
        precondition(ServerEnvironment.signal(in: "CODEX_LOOKOUT_READY") == .ready)
        precondition(ServerEnvironment.signal(in: "Codex 瞭望台已启动") == .ready)
        precondition(ServerEnvironment.signal(in: "CODEX_LOOKOUT_UPDATE_REQUEST") == .updateRequested)
        precondition(ServerEnvironment.signal(in: "ordinary output") == nil)
        print("Server environment tests passed")
    }
}
