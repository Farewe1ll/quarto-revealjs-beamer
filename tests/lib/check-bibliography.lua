-- Exercise failure paths that citeproc would otherwise reject before HTML exists.
-- The actual extension Meta hook runs with only its Quarto output sinks replaced.
return {
  Pandoc = function(doc)
    local headers, warnings
    quarto = {
      doc = {
        include_text = function(_, value) headers[#headers + 1] = value end,
        add_html_dependency = function() end,
      },
      log = { warning = function(value) warnings[#warnings + 1] = value end },
    }
    dofile("_extensions/beamerslides/beamer.lua")
    local extension_meta = Meta
    local function check(sources, expected, warning)
      headers, warnings = {}, {}
      local values = pandoc.List()
      for _, source in ipairs(sources) do
        values:insert(pandoc.MetaString(source))
      end
      extension_meta({
        bibliography = pandoc.MetaList(values),
        ["refs-order"] = pandoc.MetaString("declaration"),
      })
      local actual
      for _, header in ipairs(headers) do
        actual = actual or header:match('name="beamer%-refs%-keys" content="([^"]+)"')
      end
      assert(actual == expected, "unexpected declaration keys: " .. tostring(actual))
      if warning then
        assert(table.concat(warnings, "\n"):match(warning), "missing warning: " .. warning)
      else
        assert(#warnings == 0, table.concat(warnings, "\n"))
      end
    end
    check({"tests/fixtures/refs-order-a.bib", "tests/fixtures/refs-order-b.bib"},
      "zulu,delta,alpha,unused")
    check({"tests/fixtures/refs-order-compensated.bib"}, "zulu,delta,alpha")
    check({"tests/fixtures/refs-order-a.bib", "tests/fixtures/refs-order-duplicate.bib"},
      nil, "Duplicate bibliography key 'zulu'")
    check({"tests/fixtures/refs-order-invalid.bib"}, nil, "Could not parse bibliography")
    check({"tests/fixtures/refs-order-missing.bib"}, nil, "Could not read bibliography")
    check({"tests/fixtures/refs-order.json"}, nil, "requires a BibTeX or BibLaTeX file")
    check({}, nil)
    check({""}, nil)
    io.stderr:write("Bibliography parser and fallback checks passed.\n")
    return doc
  end,
}
