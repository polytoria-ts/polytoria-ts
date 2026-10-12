<h1 align="center">polytoria-ts</h1>
<div align="center">A TypeScript-to-Luau Compiler for Polytoria</div>
<br>
<div>&nbsp;</div>

## Introduction

**polytoria-ts** is an attempt to port [roblox-ts](https://github.com/roblox-ts/roblox-ts) and its tooling to Polytoria. You are looking at the compiler port. The compiler has had several changes made to emit Polytoria-compatible code:
- Compiler ([npm](https://www.npmjs.com/package/polytoria-ts))
	- Instance:GetFirstChild, Instance:FindFirstChild have been swapped for their Polytoria equivalents
	- ServiceProvider:GetService has been swapped for a regular index operation
- Types
	- [@polytoria-ts/types](https://github.com/pine-forest-dweller/polyts-types) ([npm](https://www.npmjs.com/package/@polytoria-ts/types)) has been introduced to parse [Polytoria/Docs-v2](https://github.com/Polytoria/Docs-v2) and generate type/enum definitions
- Runtime
	- The use of the `_G` global table has been replaced by `world.Shared`, since `_G` is readonly in Polytoria
- Projects
	- [create-polytoria-ts](https://github.com/pine-forest-dweller/create-polytoria-ts) ([npm](https://www.npmjs.com/package/create-polytoria-ts)) has been forked from `create-roblox-ts` and provides a starter project with a `default.project.json`
	- [pojo](https://github.com/pine-forest-dweller/polyts-pojo) ([npm](https://www.npmjs.com/package/@polytoria-ts/pojo)) has been developed as a prototype to sync compiled code into Polytoria's editor

## How do I use this?
See Pojo's npm page ([here](https://www.npmjs.com/package/@polytoria-ts/pojo)). It will guide you through project creation.
