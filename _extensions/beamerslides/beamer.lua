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
  include_variant_bootstrap(variant)
  return meta
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
    div.attributes["data-title"] = title
    div.attributes.title = nil
  end

  return div
end
