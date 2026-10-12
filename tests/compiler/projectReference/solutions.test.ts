import fs from "fs-extra";
import { ProjectType } from "Shared/constants";

import { expectSuccess, ReferenceFixture, startWatch } from "../referenceFixture";

jest.setTimeout(30000);

let fixture: ReferenceFixture;
beforeEach(() => {
	fixture = new ReferenceFixture({ rojo: undefined, includePath: undefined });
});
afterEach(() => fixture.close());

function addPackage(name: string) {
	fixture.json(`${name}/package.json`, { name: `@rbxts/${name}`, version: "1.0.0" });
	fixture.json(`${name}/default.project.json`, { name, tree: { $path: "out" } });
	fixture.json(`${name}/tsconfig.lib.json`, {
		extends: "../base.json",
		compilerOptions: {
			composite: true,
			rootDir: "src",
			outDir: "out",
			tsBuildInfoFile: "out/lib.tsbuildinfo",
		},
		include: ["src"],
	});
	fixture.json(`${name}/tsconfig.spec.json`, {
		extends: "../base.json",
		compilerOptions: {
			composite: true,
			rootDir: "test",
			outDir: "out-test",
			tsBuildInfoFile: "out-test/spec.tsbuildinfo",
		},
		rbxts: { type: "game", rojo: "./test.project.json", includePath: "./include" },
		include: ["test"],
		references: [{ path: "./tsconfig.lib.json" }],
	});
	fixture.json(`${name}/tsconfig.json`, {
		compilerOptions: { composite: true },
		files: [],
		include: [],
		references: [{ path: "./tsconfig.lib.json" }, { path: "./tsconfig.spec.json" }],
	});
	fixture.json(`${name}/test.project.json`, {
		name,
		tree: {
			$className: "DataModel",
			Hidden: {
				$className: "Hidden",
				[name]: { $path: "out" },
				runtime: { $path: "include" },
			},
			ScriptService: {
				$className: "ScriptService",
				$path: "out-test",
			},
		},
	});
	fixture.write(`${name}/src/value.ts`, "export const value = 42;");
	fixture.write(`${name}/src/index.ts`, 'import { value } from "./value"; export const answer = value;');
	fixture.write(
		`${name}/test/main.server.ts`,
		`import { answer } from "../src"; assert(answer === 42); print("${name} passed");`,
	);
}

function createSolution() {
	return fixture.createBuild({ type: ProjectType.Game });
}

it("builds nested lib/spec solutions with independent game runtimes", () => {
	addPackage("first");
	addPackage("second");
	const second = fs.readJsonSync(fixture.file("second/tsconfig.spec.json"));
	second.references.push({ path: "../first" }, { path: "../first/tsconfig.lib.json" });
	fixture.json("second/tsconfig.spec.json", second);
	const rojo = fs.readJsonSync(fixture.file("second/test.project.json"));
	rojo.tree.Hidden.relocated = { $path: "../first/out" };
	fixture.json("second/test.project.json", rojo);
	fixture.write(
		"second/test/main.server.ts",
		'import { answer } from "../../first/src"; assert(answer === 42); print("second passed");',
	);
	fixture.json("game/tsconfig.json", {
		files: [],
		references: [{ path: "../first" }, { path: "../second" }],
	});

	const build = createSolution();
	expectSuccess(build.build());

	for (const name of ["first", "second"]) {
		expect(fixture.read(`${name}/out/init.luau`)).toContain("local TS = _G[script]");
		expect(fixture.read(`${name}/out-test/main.server.luau`)).toContain(
			`"${name === "first" ? name : "relocated"}"`,
		);
		expect(fs.existsSync(fixture.file(`${name}/include/RuntimeLib.luau`))).toBe(true);
		expect(build.isOutputPath(fixture.file(`${name}/include/RuntimeLib.luau`))).toBe(true);
	}
	expect(fs.existsSync(fixture.file("game/include"))).toBe(false);
	expect(build.build().emittedFiles).toEqual([]);
	expect(
		Object.fromEntries(
			["first/out/init.luau", "first/out-test/main.server.luau", "second/out-test/main.server.luau"].map(file => [
				file,
				fixture.read(file),
			]),
		),
	).toMatchSnapshot();
});

it.each([false, true])("ignores Rojo files beside empty grouping configs (shared deployment=%s)", shared => {
	addPackage("shared");
	fixture.json("game/package.json", { name: "@rbxts/workspace", version: "1.0.0" });
	fixture.json("game/tsconfig.json", { files: [], references: [{ path: "../editor" }] });
	fixture.json("editor/tsconfig.json", {
		files: [],
		rbxts: { rojo: "./default.project.json" },
		references: [{ path: "../shared" }],
	});
	fixture.write("game/default.project.json", "{");
	fixture.write("editor/default.project.json", "{");

	const build = fixture.createBuild({
		type: ProjectType.Game,
		rojo: shared ? fixture.file("shared/test.project.json") : undefined,
		includePath: shared ? fixture.file("shared/include") : undefined,
	});
	expectSuccess(build.build());
	expect(build.isOutputPath(fixture.file("game/include/new.ts"))).toBe(false);
	expect(build.isConfigPath(fixture.file("editor/default.project.json"))).toBe(false);
});

it("preserves an automatically discovered shared deployment for an unscoped solution", () => {
	fixture.project("shared");
	fixture.json("game/tsconfig.json", { files: [], references: [{ path: "../shared" }] });
	const rojo = fs.readJsonSync(fixture.file("default.project.json"));
	rojo.tree.Hidden.shared.$path = "../out/shared";
	fixture.json("game/default.project.json", rojo);
	fixture.write("shared/src/value.ts", "export const value = 42;");
	fixture.write("shared/src/index.ts", 'import { value } from "./value"; export const answer = value;');

	expectSuccess(createSolution().build());
	expect(fixture.read("out/shared/init.luau")).toContain("game.Hidden");
	expect(fs.existsSync(fixture.file("game/include/RuntimeLib.luau"))).toBe(true);
	expect(fs.existsSync(fixture.file("shared/include"))).toBe(false);
});

it("rebuilds a library when switching between standalone and solution builds", () => {
	addPackage("shared");
	fixture.json("game/tsconfig.json", { files: [], references: [{ path: "../shared" }] });
	fixture.json("standalone/tsconfig.json", {
		files: [],
		references: [{ path: "../shared/tsconfig.spec.json" }],
	});
	const standalone = () =>
		fixture.createBuild(
			{
				rojo: fixture.file("shared/test.project.json"),
				includePath: fixture.file("shared/include"),
				type: ProjectType.Game,
			},
			"standalone",
		);

	expectSuccess(standalone().build());
	const deployed = fixture.read("shared/out/init.luau");
	expect(deployed).toContain("game.Hidden");

	expectSuccess(createSolution().build());
	expect(fixture.read("shared/out/init.luau")).toContain("local TS = _G[script]");

	expectSuccess(standalone().build());
	expect(fixture.read("shared/out/init.luau")).toBe(deployed);
});

it("rejects incompatible game mounts reached through an empty solution", () => {
	addPackage("first");
	addPackage("second");
	fixture.write("first/test/helper.ts", 'import { answer } from "../src"; export const result = answer;');
	const second = fs.readJsonSync(fixture.file("second/tsconfig.spec.json"));
	second.references.push({ path: "../first" });
	fixture.json("second/tsconfig.spec.json", second);
	const rojo = fs.readJsonSync(fixture.file("second/test.project.json"));
	rojo.tree.Hidden.otherGame = { $path: "../first/out-test" };
	fixture.json("second/test.project.json", rojo);
	fixture.write(
		"second/test/main.server.ts",
		'import { result } from "../../first/test/helper"; assert(result === 42);',
	);
	fixture.json("game/tsconfig.json", { files: [], references: [{ path: "../second" }] });

	expect(() => createSolution()).toThrow("same Roblox path");
	expect(fs.existsSync(fixture.file("first/out/init.luau"))).toBe(false);
});

it("reports a missing root deployment without blaming an unmounted grouped game", () => {
	addPackage("shared");
	fixture.project("game", ["shared"]);
	const rojo = fs.readJsonSync(fixture.file("shared/test.project.json"));
	rojo.tree.Hidden.runtime.$path = "../game/include";
	fixture.json("shared/test.project.json", rojo);

	const result = fixture.createBuild().build();
	expect(result.emitSkipped).toBe(true);
	expect(result.diagnostics.map(diagnostic => diagnostic.messageText)).toEqual([
		"Non-package projects must have a Rojo project file!",
	]);
	expect(fs.existsSync(fixture.file("shared/out-test/main.server.luau"))).toBe(true);
});

it.each([undefined, ProjectType.Package])("uses the consumer runtime for package output (type=%s)", type => {
	addPackage("shared");
	const config = fs.readJsonSync(fixture.file("shared/tsconfig.lib.json"));
	config.rbxts = { type, rojo: "./test.project.json", includePath: "./unused-include" };
	fixture.json("shared/tsconfig.lib.json", config);
	fixture.json("game/tsconfig.json", { files: [], references: [{ path: "../shared" }] });

	expectSuccess(createSolution().build());
	expect(fixture.read("shared/out/init.luau")).toContain("local TS = _G[script]");
	expect(fs.existsSync(fixture.file("shared/unused-include"))).toBe(false);
});

it("watches independent games and preserves their runtimes during output cleanup", async () => {
	addPackage("first");
	addPackage("second");
	fixture.json("game/tsconfig.json", {
		files: [],
		references: [{ path: "../first" }, { path: "../second" }],
	});
	for (const name of ["first", "second"]) {
		const config = fs.readJsonSync(fixture.file(`${name}/tsconfig.spec.json`));
		config.rbxts.includePath = "./out-test/runtime";
		config.rbxts.luau = name === "first";
		fixture.json(`${name}/tsconfig.spec.json`, config);
		const rojo = fs.readJsonSync(fixture.file(`${name}/test.project.json`));
		rojo.tree.Hidden.runtime.$path = "out-test/runtime";
		delete rojo.tree.ScriptService.$path;
		rojo.tree.ScriptService.main = {
			$path: `out-test/main.server.${name === "first" ? "luau" : "lua"}`,
		};
		fixture.json(`${name}/test.project.json`, rojo);
		fixture.write(`${name}/test/orphan.ts`, "export const value = 1;");
	}

	const watch = await startWatch(fixture);
	try {
		expect(watch.log).toContain("Found 0 errors");
		await watch.edit(() => {
			for (const name of ["first", "second"]) {
				fs.removeSync(fixture.file(`${name}/test/orphan.ts`));
			}
		});
		for (const name of ["first", "second"]) {
			const extension = name === "first" ? "luau" : "lua";
			expect(fs.existsSync(fixture.file(`${name}/out-test/orphan.${extension}`))).toBe(false);
			expect(fs.existsSync(fixture.file(`${name}/out-test/runtime/RuntimeLib.${extension}`))).toBe(true);
		}

		await watch.edit(() => {
			const config = fs.readJsonSync(fixture.file("second/tsconfig.spec.json"));
			config.rbxts.includePath = "./moved-include";
			fixture.json("second/tsconfig.spec.json", config);
			const rojo = fs.readJsonSync(fixture.file("second/test.project.json"));
			rojo.tree.Hidden.moved = { $path: "moved-include" };
			delete rojo.tree.Hidden.runtime;
			fixture.json("second/test.project.json", rojo);
		});
		expect(watch.log.slice(watch.log.lastIndexOf("Found "))).toContain("Found 0 errors");
		expect(fixture.read("second/out-test/main.server.lua")).toContain('WaitChild("moved")');
		expect(fs.existsSync(fixture.file("second/moved-include/RuntimeLib.lua"))).toBe(true);
	} finally {
		await watch.close();
	}
});

it("keeps package-local imports when a standalone library builds another library", () => {
	addPackage("first");
	addPackage("second");
	const config = fs.readJsonSync(fixture.file("second/tsconfig.lib.json"));
	config.references = [{ path: "../first/tsconfig.lib.json" }];
	fixture.json("second/tsconfig.json", config);
	fixture.write("second/src/types.ts", 'export type Upstream = typeof import("../../first/src");');

	expectSuccess(fixture.createBuild({}, "second").build());
	expect(fixture.read("first/out/init.luau")).toContain('TS.import(script, script, "value")');
	expect(fixture.read("second/out/init.luau")).toContain('TS.import(script, script, "value")');
});

it("accepts output and runtime mounts inside a composite project's default rootDir", () => {
	addPackage("first");
	const config = fs.readJsonSync(fixture.file("first/tsconfig.spec.json"));
	delete config.compilerOptions.rootDir;
	config.compilerOptions.rootDirs = ["src", "test"];
	fixture.json("first/tsconfig.json", config);
	const build = fixture.createBuild({}, "first");

	expectSuccess(build.build());
	expect(fixture.read("first/out-test/test/main.server.luau")).toContain('"first"');
	expect(fs.existsSync(fixture.file("first/out-test/default.project.json"))).toBe(false);

	fixture.write("first/test/main.server.ts", 'import { answer } from "../src"; assert(answer === 42);');
	expectSuccess(build.build([fixture.file("first/test/main.server.ts")]));
});

it("explains incompatible game mounts referenced by a standalone package", () => {
	addPackage("first");
	addPackage("second");
	const config = fs.readJsonSync(fixture.file("first/tsconfig.lib.json"));
	config.references = [{ path: "../second/tsconfig.spec.json" }];
	fixture.json("first/tsconfig.json", config);

	expect(() => fixture.createBuild({}, "first")).toThrow(
		"Set rbxts.rojo on the package or compile the reference as a package",
	);
});
