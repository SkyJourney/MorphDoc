# GFM 基础特性

## 文本样式

普通段落（反向验证用的临时改动），包含 **加粗**、*斜体*、~~删除线~~、`行内代码` 和 [链接](https://example.com/path?a=1&b=2)。
自动链接：https://example.com 与 <https://example.org>。

> 一级引用
>
> > 二级引用，包含 **加粗** 文本。

---

## 列表

1. 有序一
   - 无序嵌套 A
   - 无序嵌套 B
     1. 三级有序
     2. 三级有序二
2. 有序二

- [x] 已完成任务
- [ ] 待处理任务
- [ ] 含 `代码` 的任务

## 表格

| 左对齐 | 居中 | 右对齐 |
| :--- | :---: | ---: |
| a | b | 1 |
| 长一点的内容 | c | 22 |

## 代码

```ts
const answer: number = 42;
export function add(a: number, b: number): number {
  return a + b;
}
```

```python
def greet(name: str) -> str:
    return f"你好，{name}"
```

```json
{ "name": "morphdoc", "nested": { "list": [1, 2, 3] } }
```

## 脚注

这里有一个脚注引用[^one]，还有另一个[^two]。

[^one]: 第一条脚注。
[^two]: 第二条脚注，包含 `代码`。
