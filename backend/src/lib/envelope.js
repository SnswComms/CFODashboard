function envelope(data, meta = {}) {
  return {
    data,
    meta: {
      dataSource: meta.dataSource ?? "missing",
      sourcePath: meta.sourcePath ?? null,
      generated_at: meta.generated_at ?? null,
      warnings: meta.warnings ?? [],
      ...meta.extra,
    },
  };
}

module.exports = { envelope };
