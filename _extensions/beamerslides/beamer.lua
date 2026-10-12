local allowed_variants = {
  madrid = true,
  cambridgeus = true,
}

local allowed_booleans = {
  ["true"] = "true",
  ["yes"] = "true",
  ["1"] = "true",
  ["false"] = "false",
  ["no"] = "false",
  ["0"] = "false",
}

local function stringify(value)
  if value == nil then
    return nil
  end
  return pandoc.utils.stringify(value)
end

local function escape_html(value)
  return value
    :gsub("&", "&amp;")
    :gsub('"', "&quot;")
    :gsub("<", "&lt;")
    :gsub(">", "&gt;")
end

local function warning(message)
  if quarto and quarto.log then
    quarto.log.warning(message)
  else
    io.stderr:write("WARNING: " .. message .. "\n")
  end
end

local function include_meta(name, value)
  if value == nil or value == "" then
    return
  end
  if quarto == nil or quarto.doc == nil then
    return
  end
  quarto.doc.include_text(
    "in-header",
    '<meta name="' .. name .. '" content="' .. escape_html(value) .. '">'
  )
end

local function include_variant_bootstrap(variant)
  if quarto == nil or quarto.doc == nil then
    return
  end
  quarto.doc.include_text(
    "in-header",
    '<script>document.documentElement.classList.add("beamer-' .. variant .. '");</script>'
  )
end

-- Declaration-order contract and fallback policy: docs/architecture.md, R3.
-- This line-anchored scan avoids inline @ mentions, but is not a full BibTeX
-- parser: split headers can be missed and multiline fields can contain false
-- headers. Keep those boundaries visible when changing the JS count guard.
local ignored_entry_types = {
  ["string"] = true,
  ["comment"] = true,
  ["preamble"] = true,
}

local function bib_entry_keys(text)
  local keys = pandoc.List()
  for line in text:gmatch("[^\r\n]+") do
    local entry_type, key = line:match("^%s*@(%a+)%s*[%{%(]%s*([^,%s{}]+)%s*,")
    if entry_type ~= nil and not ignored_entry_types[entry_type:lower()] then
      keys:insert(key)
    end
  end
  return keys
end

local function read_file(path)
  local handle = io.open(path, "r")
  if handle == nil then
    return nil
  end
  local text = handle:read("a")
  handle:close()
  return text
end

-- Resolve a bibliography path the way pandoc does: as given, then relative to the
-- project directory, then relative to each resource-path entry.
local function candidate_paths(value)
  local paths = pandoc.List()
  local raw = pandoc.utils.stringify(value)
  -- Older supported Quarto releases lack quarto.project. Expand "." in the
  -- resource path explicitly instead of resolving it against the Lua process cwd.
  local project = quarto and quarto.project and quarto.project.directory
  if project and project ~= "" then
    paths:insert(project .. "/" .. raw)
  end
  local resource = PANDOC_STATE and PANDOC_STATE.resource_path
  if type(resource) == "table" then
    for _, entry in ipairs(resource) do
      if entry == "." then
        paths:insert(raw)
      elseif entry ~= "" then
        paths:insert(entry .. "/" .. raw)
      end
    end
  end
  -- Last, so that a bare relative path still resolves if nothing else did.
  paths:insert(raw)
  return paths
end

local function bibliography_key_list(meta)
  local bibliography = meta["bibliography"]
  if bibliography == nil then
    return nil
  end

  local values = pandoc.List()
  if type(bibliography) == "table" and #bibliography > 0 then
    for _, value in ipairs(bibliography) do
      values:insert(value)
    end
  else
    values:insert(bibliography)
  end

  local keys = pandoc.List()
  for _, value in ipairs(values) do
    -- `bibliography: ""` and `bibliography: []` pass Quarto's front-matter schema (a
    -- bare `bibliography:` does not -- it is rejected before any filter runs), and
    -- they must not be reported as a file that could not be read.
    local raw = pandoc.utils.stringify(value)
    if raw ~= "" then
      local text = nil
      for _, path in ipairs(candidate_paths(value)) do
        text = read_file(path)
        if text ~= nil then
          break
        end
      end
      if text == nil then
        warning(
          "Could not read bibliography '"
            .. raw
            .. "'; references keep citeproc's order."
        )
        return nil
      end
      for _, key in ipairs(bib_entry_keys(text)) do
        keys:insert(key)
      end
    end
  end

  if #keys == 0 then
    return nil
  end
  return keys
end

local function declaration_order_enabled(meta)
  local raw = stringify(meta["refs-order"])
  if raw == nil or raw == "" then
    return false
  end
  local value = raw:lower()
  if value == "declaration" then
    return true
  end
  if value ~= "citation" then
    warning("Unknown refs-order '" .. value .. "'; using 'citation'.")
  end
  return false
end

local function resolved_refs_overflow(meta)
  local raw = stringify(meta["refs-overflow"])
  if raw == nil or raw == "" then
    return "paginate"
  end
  local value = raw:lower()
  if value == "paginate" or value == "scroll" then
    return value
  end
  warning("Unknown refs-overflow '" .. value .. "'; using 'paginate'.")
  return "paginate"
end

local dependency_registered = false
local function register_dependency()
  if dependency_registered then
    return
  end
  if quarto == nil or quarto.doc == nil or quarto.doc.add_html_dependency == nil then
    warning("Unable to register beamerslides browser resources.")
    return
  end

  quarto.doc.add_html_dependency({
    name = "beamerslides",
    scripts = { "beamer.js" },
    stylesheets = { "beamer-fonts.css" },
    resources = {
      {
        name = "fonts/LibertinusSans-Regular.woff2",
        path = "fonts/LibertinusSans-Regular.woff2",
      },
      {
        name = "fonts/LibertinusSans-Italic.woff2",
        path = "fonts/LibertinusSans-Italic.woff2",
      },
      {
        name = "fonts/LibertinusSans-Bold.woff2",
        path = "fonts/LibertinusSans-Bold.woff2",
      },
      {
        name = "OFL.txt",
        path = "fonts/OFL.txt",
      },
    },
  })
  dependency_registered = true
end

local function normalized_boolean(meta, name)
  if meta[name] == nil then
    return nil
  end

  local value = (stringify(meta[name]) or ""):lower()
  local normalized = allowed_booleans[value]
  if normalized == nil then
    warning("Unknown " .. name .. " value '" .. value .. "'; ignoring it.")
  end
  return normalized
end

function Meta(meta)
  register_dependency()
  local variant = stringify(meta["beamer-variant"]) or "madrid"
  variant = variant:lower()

  if not allowed_variants[variant] then
    warning("Unknown beamer-variant '" .. variant .. "'; using 'madrid'.")
    variant = "madrid"
  end

  include_meta("beamer-variant", variant)
  include_meta("beamer-short-title", stringify(meta["short-title"]))
  include_meta("beamer-short-author", stringify(meta["short-author"]))
  include_meta("beamer-short-institute", stringify(meta["short-institute"]))
  include_meta("beamer-short-date", stringify(meta["short-date"]))
  include_meta("beamer-secheader", normalized_boolean(meta, "beamer-secheader"))
  include_meta("beamer-progress", normalized_boolean(meta, "beamer-progress"))
  include_meta("beamer-refs-title", stringify(meta["refs-title"]))
  include_meta("beamer-refs-overflow", resolved_refs_overflow(meta))

  -- Only shipped when the document asks for declaration order, since it costs a
  -- read of every bibliography file.
  if declaration_order_enabled(meta) then
    local keys = bibliography_key_list(meta)
    if keys ~= nil then
      include_meta("beamer-refs-keys", table.concat(keys, ","))
    end
  end

  include_variant_bootstrap(variant)
  return meta
end

-- Split on ASCII whitespace: locale-aware %s can match bytes inside UTF-8
-- words and corrupt CJK titles. Literal-title semantics are documented in G3.
local function title_inlines(value)
  local inlines = pandoc.List()
  for word in value:gmatch("[^ \t\r\n]+") do
    if #inlines > 0 then
      inlines:insert(pandoc.Space())
    end
    inlines:insert(pandoc.Str(word))
  end
  return inlines
end

local block_kinds = {
  ["block"] = "beamer-block",
  ["beamer-block"] = "beamer-block",
  ["exampleblock"] = "beamer-block beamer-example",
  ["example-block"] = "beamer-block beamer-example",
  ["alertblock"] = "beamer-block beamer-alert",
  ["alert-block"] = "beamer-block beamer-alert",
}

function Div(div)
  local kind = nil
  for _, class_name in ipairs(div.classes) do
    if block_kinds[class_name] then
      kind = block_kinds[class_name]
      break
    end
  end

  if kind == nil then
    return nil
  end

  local normalized_classes = pandoc.List()
  for _, class_name in ipairs(div.classes) do
    if block_kinds[class_name] == nil then
      normalized_classes:insert(class_name)
    end
  end
  for class_name in kind:gmatch("%S+") do
    if not normalized_classes:includes(class_name) then
      normalized_classes:insert(class_name)
    end
  end
  div.classes = normalized_classes

  local title = div.attributes.title
  if title and title ~= "" then
    div.attributes.title = nil
    -- Real title nodes and legacy data-title compatibility: G3.
    div.content:insert(
      1,
      pandoc.Div(
        { pandoc.Plain(title_inlines(title)) },
        pandoc.Attr("", { "beamer-block-title" })
      )
    )
  end

  return div
end
