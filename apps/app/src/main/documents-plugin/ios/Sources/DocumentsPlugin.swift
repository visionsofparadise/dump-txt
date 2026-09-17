import CryptoKit
import Foundation
import Tauri
import UIKit
import UniformTypeIdentifiers

private struct DocumentOptions: Decodable {
    var title: String?
    var fileName: String?
    var extensions: [String]?
    var writable: Bool?
}

private struct ResolveDocumentOptions: Decodable {
    let path: String
    var writable: Bool?
}

class DocumentsPlugin: Plugin, UIDocumentPickerDelegate {
    private var pending: Invoke?
    private var pendingWritable = true
    private var temporaryDirectory: URL?
    private var scopedUrls: [String: (url: URL, count: Int)] = [:]

    deinit {
        for lease in scopedUrls.values {
            for _ in 0..<lease.count {
                lease.url.stopAccessingSecurityScopedResource()
            }
        }
    }

    @objc public func openDocument(_ invoke: Invoke) throws {
        let options = try invoke.parseArgs(DocumentOptions.self)

        DispatchQueue.main.async {
            guard self.pending == nil else {
                invoke.reject("A document picker is already open.")
                return
            }

            let extensions = options.extensions ?? []
            let contentTypes = extensions.contains("*") ? [] : extensions.compactMap { UTType(filenameExtension: $0) }
            let picker = UIDocumentPickerViewController(
                forOpeningContentTypes: contentTypes.isEmpty ? [.item] : contentTypes,
                asCopy: false)

            self.present(picker, invoke: invoke, writable: options.writable ?? true, title: options.title)
        }
    }

    @objc public func createDocument(_ invoke: Invoke) throws {
        let options = try invoke.parseArgs(DocumentOptions.self)

        DispatchQueue.main.async {
            guard self.pending == nil else {
                invoke.reject("A document picker is already open.")
                return
            }

            do {
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                let suggestedName = (options.fileName ?? "page.txt") as NSString
                let name = suggestedName.lastPathComponent.isEmpty ? "page.txt" : suggestedName.lastPathComponent
                let source = directory.appendingPathComponent(name)

                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                try Data().write(to: source, options: .atomic)

                self.temporaryDirectory = directory

                let picker = UIDocumentPickerViewController(forExporting: [source], asCopy: false)

                self.present(picker, invoke: invoke, writable: true, title: options.title)
            } catch {
                self.finish()
                invoke.reject(error.localizedDescription)
            }
        }
    }

    @objc public func resolveDocument(_ invoke: Invoke) throws {
        let options = try invoke.parseArgs(ResolveDocumentOptions.self)

        DispatchQueue.main.async {
            do {
                let bookmarkPath = try self.bookmarkPath(of: options.path)

                guard let bookmark = try? Data(contentsOf: bookmarkPath) else {
                    invoke.resolve(["document": NSNull()])
                    return
                }

                var stale = false

                guard let url = try? URL(resolvingBookmarkData: bookmark, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else {
                    invoke.resolve(["document": NSNull()])
                    return
                }

                let document = try self.document(of: url, writable: options.writable ?? true, retain: true, alias: options.path)

                invoke.resolve(["document": document])
            } catch {
                let failure = error as NSError
                let unavailable = [CocoaError.Code.fileNoSuchFile.rawValue, CocoaError.Code.fileReadNoSuchFile.rawValue, CocoaError.Code.fileReadNoPermission.rawValue, CocoaError.Code.fileWriteNoPermission.rawValue]

                if failure.domain == NSCocoaErrorDomain && unavailable.contains(failure.code) {
                    invoke.resolve(["document": NSNull()])
                } else {
                    invoke.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc public func releaseDocument(_ invoke: Invoke) throws {
        let options = try invoke.parseArgs(ResolveDocumentOptions.self)

        DispatchQueue.main.async {
            if let lease = self.scopedUrls[options.path] {
                lease.url.stopAccessingSecurityScopedResource()

                if lease.count == 1 {
                    self.scopedUrls.removeValue(forKey: options.path)
                } else {
                    self.scopedUrls[options.path] = (lease.url, lease.count - 1)
                }
            }

            invoke.resolve()
        }
    }

    private func present(_ picker: UIDocumentPickerViewController, invoke: Invoke, writable: Bool, title: String?) {
        guard let controller = manager.viewController else {
            finish()
            invoke.reject("The document picker has no presenting view.")
            return
        }

        pending = invoke
        pendingWritable = writable
        picker.delegate = self
        picker.allowsMultipleSelection = false
        picker.modalPresentationStyle = .fullScreen
        picker.title = title

        controller.present(picker, animated: true)
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let invoke = pending else { return }

        defer { finish() }

        guard let url = urls.first else {
            invoke.resolve(["document": NSNull()])
            return
        }

        do {
            invoke.resolve(["document": try document(of: url, writable: pendingWritable)])
        } catch {
            invoke.reject(error.localizedDescription)
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pending?.resolve(["document": NSNull()])
        finish()
    }

    private func document(of url: URL, writable: Bool, retain: Bool = false, alias: String? = nil) throws -> [String: String] {
        let accessed = url.startAccessingSecurityScopedResource()
        var retained = false

        defer {
            if accessed && !retained {
                url.stopAccessingSecurityScopedResource()
            }
        }

        let values = try url.resourceValues(forKeys: [.nameKey, .isReadableKey, .isWritableKey])

        if values.isReadable == false {
            throw CocoaError(.fileReadNoPermission)
        }

        if writable && values.isWritable == false {
            throw CocoaError(.fileWriteNoPermission)
        }

        let bookmark = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)

        try bookmark.write(to: bookmarkPath(of: url.absoluteString), options: .atomic)

        if let alias = alias, alias != url.absoluteString {
            try bookmark.write(to: bookmarkPath(of: alias), options: .atomic)
        }

        if retain && accessed {
            let count = scopedUrls[url.absoluteString]?.count ?? 0

            scopedUrls[url.absoluteString] = (url, count + 1)
            retained = true
        }

        return ["path": url.absoluteString, "name": values.name ?? url.lastPathComponent]
    }

    private func bookmarkPath(of reference: String) throws -> URL {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let directory = support.appendingPathComponent("document-bookmarks", isDirectory: true)
        let hash = SHA256.hash(data: Data(reference.utf8)).map { String(format: "%02x", $0) }.joined()

        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        return directory.appendingPathComponent(hash).appendingPathExtension("bookmark")
    }

    private func finish() {
        pending = nil

        if let directory = temporaryDirectory {
            try? FileManager.default.removeItem(at: directory)
            temporaryDirectory = nil
        }
    }
}

@_cdecl("init_plugin_documents")
func initDocumentsPlugin() -> Plugin {
    DocumentsPlugin()
}
