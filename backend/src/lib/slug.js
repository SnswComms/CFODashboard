function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function matchesSlugOrName(param, name) {
  const decoded = decodeURIComponent(String(param));
  return decoded === name || slugify(decoded) === slugify(name);
}

module.exports = { slugify, matchesSlugOrName };
