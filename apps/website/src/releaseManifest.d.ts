interface ReleaseDownload {
	readonly name: string;
	readonly url: string;
	readonly bytes: number;
}

interface ReleaseManifest {
	readonly tag: string;
	readonly version: string;
	readonly downloads: {
		readonly windows: { readonly x64: ReleaseDownload };
		readonly macos: { readonly arm64: ReleaseDownload; readonly x64: ReleaseDownload };
		readonly linux: { readonly appImage: ReleaseDownload; readonly deb: ReleaseDownload };
	};
}

declare const releaseManifest: ReleaseManifest;
