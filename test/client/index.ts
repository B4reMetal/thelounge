// Recursively load all JS files (test files) in the `js` folder
// Webpack's require.context is not in standard Node.js types
interface WebpackRequire {
	context(
		directory: string,
		useSubdirectories: boolean,
		regExp: RegExp
	): {
		keys(): string[];
		(id: string): unknown;
	};
}

const context = (require as unknown as WebpackRequire).context("./js", true, /.+\.ts$/);
context.keys().forEach(context);

export default context;
