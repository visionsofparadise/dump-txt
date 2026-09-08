import AppKit
import ApplicationServices

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}

func rectangle(_ element: AXUIElement) -> CGRect {
    guard let position = attribute(element, kAXPositionAttribute), let size = attribute(element, kAXSizeAttribute) else {
        fail("Accessibility element has no geometry")
    }
    var point = CGPoint.zero
    var dimensions = CGSize.zero
    AXValueGetValue(position as! AXValue, .cgPoint, &point)
    AXValueGetValue(size as! AXValue, .cgSize, &dimensions)
    return CGRect(origin: point, size: dimensions)
}

func pointer(_ point: CGPoint, _ kind: CGEventType, _ alternate: Bool = false) {
    guard let event = CGEvent(mouseEventSource: nil, mouseType: kind, mouseCursorPosition: point, mouseButton: .left) else {
        fail("Could not create native mouse event")
    }
    if alternate { event.flags = .maskAlternate }
    event.post(tap: .cghidEventTap)
}

func movePointer(_ destination: CGPoint) {
    guard let current = CGEvent(source: nil)?.location else { fail("Could not read native pointer location") }
    for step in 1...20 {
        pointer(CGPoint(x: current.x + (destination.x-current.x)*Double(step)/20, y: current.y + (destination.y-current.y)*Double(step)/20), .mouseMoved)
        usleep(10000)
    }
    usleep(100000)
}

guard AXIsProcessTrusted(), CGPreflightPostEventAccess() else {
    fail("Native window checks require Accessibility/input permission for the nativeWindow helper")
}
let request = try JSONSerialization.jsonObject(with: Data(CommandLine.arguments[1].utf8)) as! [String: Any]
let executable = request["executable"] as! String
let apps = NSWorkspace.shared.runningApplications.filter { $0.executableURL?.standardizedFileURL.path == executable }
guard apps.count == 1 else { fail("Expected one running app with exact executable path: \(executable); found \(apps.count)") }
let app = apps[0]
let element = AXUIElementCreateApplication(app.processIdentifier)
guard let windows = attribute(element, kAXWindowsAttribute) as? [AXUIElement], windows.count == 1 else {
    fail("Expected one accessible app window")
}
let window = windows[0]
let bounds = rectangle(window)
let action = request["action"] as! String
let controls = [("close", kAXCloseButtonAttribute), ("minimize", kAXMinimizeButtonAttribute), ("maximize", kAXZoomButtonAttribute)]
switch action {
case "state":
    let screen = NSScreen.screens.first { NSIntersectsRect($0.frame, CGRect(x: bounds.minX, y: 0, width: bounds.width, height: bounds.height)) } ?? NSScreen.main!
    let visible = screen.visibleFrame
    let screenHeight = NSScreen.screens[0].frame.height
    let maximized = abs(bounds.width - visible.width) < 4 && abs(bounds.height - visible.height) < 4
    let buttons: [[String: Any]] = controls.compactMap { name, key in
        guard let control = attribute(window, key) else { return nil }
        let rect = rectangle(control as! AXUIElement)
        return ["name": name, "x": rect.minX, "y": rect.minY, "width": rect.width, "height": rect.height]
    }
    let result: [String: Any] = ["x": bounds.minX, "y": bounds.minY, "width": bounds.width, "height": bounds.height, "clientX": bounds.minX, "clientY": bounds.minY, "minimized": attribute(window, kAXMinimizedAttribute) as? Bool ?? false, "maximized": maximized, "processId": app.processIdentifier, "controls": buttons, "workAreaY": screenHeight-visible.maxY]
    print(String(data: try JSONSerialization.data(withJSONObject: result), encoding: .utf8)!)
case "restore":
    AXUIElementSetAttributeValue(window, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
    app.activate(options: [.activateIgnoringOtherApps])
case "focus":
    app.activate(options: [.activateIgnoringOtherApps])
case "pointer":
    if !app.isActive {
        app.activate(options: [.activateIgnoringOtherApps])
        usleep(100000)
    }
    let start = CGPoint(x: request["x"] as! Double, y: request["y"] as! Double)
    movePointer(start)
    pointer(start, .leftMouseDown)
    if let endX = request["endX"] as? Double, let endY = request["endY"] as? Double {
        for step in 1...20 {
            usleep(15000)
            pointer(CGPoint(x: start.x + (endX-start.x)*Double(step)/20, y: start.y + (endY-start.y)*Double(step)/20), .leftMouseDragged)
        }
        pointer(CGPoint(x: endX, y: endY), .leftMouseUp)
    } else {
        usleep(60000)
        pointer(start, .leftMouseUp)
    }
case "minimize", "maximize", "close":
    let key = controls.first { $0.0 == action }!.1
    guard let control = attribute(window, key) else { fail("Native \(action) button is unavailable") }
    let rect = rectangle(control as! AXUIElement)
    let point = CGPoint(x: rect.midX, y: rect.midY)
    if !app.isActive {
        app.activate(options: [.activateIgnoringOtherApps])
        usleep(100000)
    }
    movePointer(point)
    pointer(point, .leftMouseDown, action == "maximize")
    usleep(60000)
    pointer(point, .leftMouseUp, action == "maximize")
case "screenshot":
    guard CGPreflightScreenCaptureAccess() else { fail("Whole-window screenshots require Screen Recording permission") }
    let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
    guard let info = list.first(where: { ($0[kCGWindowOwnerPID as String] as? Int32) == app.processIdentifier && ($0[kCGWindowLayer as String] as? Int) == 0 }), let number = info[kCGWindowNumber as String] as? Int else { fail("App window is absent from screen capture list") }
    let capture = Process()
    capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    capture.arguments = ["-x", "-o", "-l", String(number), request["path"] as! String]
    try capture.run()
    capture.waitUntilExit()
    if capture.terminationStatus != 0 { fail("Native window screenshot failed") }
default:
    fail("Unknown native action: \(action)")
}
