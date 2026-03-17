import pkg from "../package.json";

const result = await Bun.build({
  entrypoints: ["./src/cli.ts"],
  outdir: "./dist",
  naming: "flget.js",
  target: "bun",
  sourcemap: "external",
  minify: true,
  define: {
    __FLGET_VERSION__: JSON.stringify(pkg.version),
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

for (const output of result.outputs) {
  console.log(`  ${output.path}  ${(output.size / 1024).toFixed(2)} KB`);
}
