local map_path = os.getenv("MORPHDOC_DOCX_MEDIA_MAP")
local structure_plan_path =
  os.getenv("MORPHDOC_DOCX_STRUCTURE_PLAN")

if map_path == nil or map_path == "" then
  error("DOCX media map path is missing")
end
if structure_plan_path == nil or structure_plan_path == "" then
  error("DOCX structure plan path is missing")
end

local function read_json(path, description)
  local file, open_error = io.open(path, "rb")
  if file == nil then
    error(
      description .. " cannot be opened: " .. tostring(open_error)
    )
  end
  local content = file:read("*a")
  file:close()
  return pandoc.json.decode(content, false)
end

local media_map = read_json(map_path, "DOCX media map")
local structure_plan =
  read_json(structure_plan_path, "DOCX structure plan")
local counters = {
  image = 0,
  mermaid = 0,
  echarts = 0
}

local function contains_class(classes, expected)
  for _, class_name in ipairs(classes) do
    if class_name == expected then
      return true
    end
  end
  return false
end

local function next_media(kind)
  counters[kind] = counters[kind] + 1
  local media = media_map[kind][counters[kind]]
  if media == nil then
    error(
      "DOCX media map does not contain "
        .. kind
        .. " #"
        .. tostring(counters[kind])
    )
  end
  return media
end

local function media_image(media)
  return pandoc.Image(
    pandoc.Inlines { pandoc.Str(media.alt_text) },
    media.path,
    media.binding,
    {
      width = media.width,
      height = media.height
    }
  )
end

local function replace_image(image)
  local media = next_media("image")
  image.src = media.path
  image.caption = pandoc.Inlines { pandoc.Str(media.alt_text) }
  image.title = media.binding
  image.attributes.width = media.width
  image.attributes.height = media.height
  return image
end

local function replace_code_block(block)
  local kind
  if contains_class(block.classes, "mermaid") then
    kind = "mermaid"
  elseif contains_class(block.classes, "echarts") then
    kind = "echarts"
  else
    return block
  end

  local media = next_media(kind)
  local image = media_image(media)
  if media.caption ~= nil and media.caption ~= "" then
    return pandoc.Figure(
      { pandoc.Plain { image } },
      pandoc.Caption {
        pandoc.Plain { pandoc.Str(media.caption) }
      }
    )
  end
  return pandoc.Para { image }
end

local function preserve_raw_html_as_text(inline)
  if inline.format == "html" then
    return pandoc.Str(inline.text)
  end
  return inline
end

local function preserve_raw_html_block_as_text(block)
  if block.format == "html" then
    return pandoc.Para { pandoc.Str(block.text) }
  end
  return block
end

local function replace_table_breaks(table_block)
  return table_block:walk {
    RawInline = function(inline)
      if inline.format ~= "html" then
        return inline
      end
      local normalized = string.lower(inline.text)
      if normalized == "<br>"
        or normalized == "<br/>"
        or normalized == "<br />" then
        return pandoc.LineBreak()
      end
      return inline
    end
  }
end

local function normalize_task_list(list)
  for _, item in ipairs(list.content) do
    local block = item[1]
    if block ~= nil and (block.t == "Plain" or block.t == "Para") then
      local inlines = block.content
      local first = inlines[1]
      if first ~= nil and first.t == "Str" then
        local marker = string.lower(first.text)
        if marker == "[x]" then
          first.text = "☒"
        elseif marker == "[" then
          local second = inlines[2]
          local third = inlines[3]
          if second ~= nil and second.t == "Space"
            and third ~= nil and third.t == "Str"
            and third.text == "]" then
            first.text = "☐"
            inlines:remove(3)
            inlines:remove(2)
          end
        end
      end
    end
  end
  return list
end

local function append_inlines(target, value)
  target:extend(pandoc.Inlines(value))
end

local function structure_paragraph(block)
  local inlines = pandoc.Inlines {}
  for index, segment in ipairs(block.segments) do
    if index > 1 then
      if block.separator == "tab" then
        inlines:insert(
          pandoc.RawInline(
            "openxml",
            "<w:r><w:tab/></w:r>"
          )
        )
      else
        inlines:insert(pandoc.Space())
      end
    end
    append_inlines(inlines, segment)
  end
  local paragraph = pandoc.Para(inlines)
  if block.styleId == nil or block.styleId == "" then
    return paragraph
  end
  return pandoc.Div(
    { paragraph },
    pandoc.Attr("", {}, { ["custom-style"] = block.styleId })
  )
end

local function marker_paragraph(marker)
  return pandoc.Para { pandoc.Str(marker) }
end

local function structure_blocks(blocks)
  local result = pandoc.Blocks {}
  for _, block in ipairs(blocks) do
    if block.kind == "paragraph" then
      result:insert(structure_paragraph(block))
    elseif block.kind == "container" then
      local children = structure_blocks(block.blocks)
      result:insert(marker_paragraph(block.startMarker))
      result:extend(children)
      result:insert(marker_paragraph(block.endMarker))
    elseif block.kind == "section-break" then
      result:insert(marker_paragraph(block.marker))
    else
      error("Unsupported DOCX structure block: " .. tostring(block.kind))
    end
  end
  return result
end

local function suppress_first_body_heading(blocks)
  for index, block in ipairs(blocks) do
    if block.t == "Header" and block.level == 1 then
      blocks:remove(index)
      return
    end
  end
end

local function validate_counts()
  for _, kind in ipairs({ "image", "mermaid", "echarts" }) do
    if counters[kind] ~= #media_map[kind] then
      error(
        "DOCX media map contains unused "
          .. kind
          .. " resources: consumed "
          .. tostring(counters[kind])
          .. " of "
          .. tostring(#media_map[kind])
      )
    end
  end
end

return {
  Pandoc = function(document)
    local transformed = document:walk {
      Table = replace_table_breaks
    }
    transformed = transformed:walk {
      Image = replace_image,
      CodeBlock = replace_code_block,
      RawInline = preserve_raw_html_as_text,
      RawBlock = preserve_raw_html_block_as_text,
      BulletList = normalize_task_list
    }
    if structure_plan.titlePolicy.metadataTitle == "suppress" then
      transformed.meta.title = nil
    end
    if structure_plan.metadataPolicy.author == "suppress" then
      transformed.meta.author = nil
    end
    if structure_plan.titlePolicy.firstBodyHeading == "suppress" then
      suppress_first_body_heading(transformed.blocks)
    end
    local blocks = structure_blocks(structure_plan.prefix)
    blocks:extend(transformed.blocks)
    blocks:extend(structure_blocks(structure_plan.suffix))
    transformed.blocks = blocks
    validate_counts()
    return transformed
  end
}
