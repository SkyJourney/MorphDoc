# 超高媒体

本文档用于验证被缩放到整页的图片、图表和流程图：它们之后的内容必须从下一页开始。每个整页媒体之前只有一个标题，连续标题的情形见 heading-chain-media.md。开头先放一段说明文字，避免“标题紧接整页图”这一特例。

### 超高图片

图前的说明段落，用来改变整页图在页面中的起始位置。这一段稍长，占据两行左右的版面。

![一张又细又高的图](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAZACAIAAACE65c3AAAFhElEQVR42u3d6+841BzA8V/klrsxxhhjHDabzdZma7N5ep7YbDabzWbHxtgxxpwx5k45ynFP5ERERPRRSimlnOim2ymliIiIiNz5J76P7PUXvP6D9/tQeuFKL1rpxSu9ZKWXrvSylV6+0itWeuVKr16prvS6ld6w0ptWevNKb13p7Su9a6X3rnT0Sn2l41b68EofW+mTK52w0okrnbTSySudstKpK5220ukrnbHSmSudvdK5K52/0oUrXbwOgcFgMBgMBoPBYDAYDAaDwQcI51dFfk3k10Z+feQ3Rm6R3xL5bZHfEfndkd8X+ZjIH4z8ocgfifzxyMdH/nTkz0b+XOQvRP5S5K9E/lrkb0SOyGdFPifyeZEviHxR5EsiXxr5sshXRr468nWRb4h8U+RbAgwGg8FgMBgMBoPBYDAYDD5IuL5z1vfM+v5ZPzDrsbOOWT866ydm/dSsn5l1zvr5Wb8465dn/eqsX5/1m7N+a9Zvz/qdWb876/dm/f6sP5j1h7NePutVs14z6/Wz3jjrzbPeOutts94+6x2z3jnrXbPePes9s947wWAwGAwGg8FgMBgMBoPB4IOExwl9nNjHSX2c3McpfZzax2l9nN7HGX2c2cfZfZzbx/l9XNjHxX2sPn7UxxV9/LiPa/vYffykj5/28bM+ftHHr/r4TR+/6+MPffypj7/08bc+/tnHf/o4rI/D+3hAH0f08dA+HtHBYDAYDAaDwWAwGAwGg8Hgg4QjWpzV4pwW57W4oMVFLS5pcWmLy1pc2eLqFte1uKHFTS1uafHzFr9s8esWv23x+xZ/bPHnFn9t8fcW/2rx3xb3aXG/Fg9s8eAWD2vxyBaPbvHYFo9v8cQWT27x1BZPb/HMBgaDwWAwGAwGg8FgMBgMBh8kvC8v+6qyryn7+rJvLPvmsm8t+7ayby/7jrLvLPuusu8u+56y7y37H2X/u+xDZd+37PuX/aCyH1L2w8t+VNmPKftxZT+h7CeV/ZSyn1b2M8p+VtnPLvs5ZT+37CPLfl7ZR5X9/LJfUMBgMBgMBoPBYDAYDAaDweCDhCX/wWAwGAwGg8FgMBgMBoPBfouS/2AwGAwGg8FgMBgMBoPBYL9FMBgMBoPBYDAYDAaDwWAw2G8RDAaDwWAwGAwGg8FgMBgM9lsEg8FgMBgMBoPBYDAYDAb7LUr+g8FgMBgMBoPBYDAYDAaD/Ra9BsBgMBgMBoPBYDAYDAaDwX6LYDAYDAaDwWAwGAwGg8FgsN8iGAwGg8FgMBgMBoPBYDDYb1HyHwwGg8FgMBgMBoPBYDAY7Lco+Q8Gg8FgMBgMBoPBYDAYDPZbBIPBYDAYDAaDwWAwGAwGg/0WwWAwGAwGg8FgMBgMBoPBfouS/2AwGAwGg8FgMBgMBoPBYL9FyX8wGAwGg8FgMBgMBoPBYLDfIhgMBoPBYDAYDAaDwWAwGOy3CAaDwWAwGAwGg8FgMBgM9luU/AeDwWAwGAwGg8FgMBgMBvstSv6DwWAwGAwGg8FgMBgMBoP9FsFgMBgMBoPBYDAYDAaDwWC/RTAYDAaDwWAwGAwGg8FgsN+i5D8YDAaDwWAwGAwGg8FgMNhvUfIfDAaDwWAwGAwGg8FgMBjstwgGg8FgMBgMBoPBYDAYDAb7LYLBYDAYDAaDwWAwGAwGg/0WJf/BYDAYDAaDwWAwGAwGg8F+i5L/YDAYDAaDwWAwGAwGg8Fgv0UwGAwGg8FgMBgMBoPBYDDYbxEMBoPBYDAYDAaDwWAwGAz2WwSDwWAwGAwGg8FgMBgMBvstSv6DwWAwGAwGg8FgMBgMBoP9Fr0GwGAwGAwGg8FgMBgMBoPBfotgMBgMBoPBYDAYDAaDwWCw3yIYDAaDwWAwGAwGg8FgMPj/Ev4fXJM5u5VaAUwAAAAASUVORK5CYII=)

图后紧跟的正文一：这一段必须从图所在页的下一页开始。

### 图 1 整页图表

```echarts
version: 1
height: 400mm
caption: 图 1：超高图表
option:
  xAxis:
    type: category
    data: [甲, 乙, 丙, 丁]
  yAxis:
    type: value
  series:
    - type: bar
      data: [4, 2, 8, 1]
```

图表后紧跟的正文二：这一段必须从图表所在页的下一页开始。

### 图 2 整页图表

```echarts
version: 1
height: 380mm
caption: 图 2：超高图表
option:
  xAxis:
    type: category
    data: [甲, 乙, 丙, 丁]
  yAxis:
    type: value
  series:
    - type: bar
      data: [5, 4, 9, 2]
```

图表后紧跟的正文三：这一段必须从图表所在页的下一页开始。

### 流程图 1

```mermaid
flowchart TD
    N0[步骤 0] --> N1[步骤 1]
    N1[步骤 1] --> N2[步骤 2]
    N2[步骤 2] --> N3[步骤 3]
    N3[步骤 3] --> N4[步骤 4]
    N4[步骤 4] --> N5[步骤 5]
    N5[步骤 5] --> N6[步骤 6]
    N6[步骤 6] --> N7[步骤 7]
    N7[步骤 7] --> N8[步骤 8]
    N8[步骤 8] --> N9[步骤 9]
    N9[步骤 9] --> N10[步骤 10]
    N10[步骤 10] --> N11[步骤 11]
    N11[步骤 11] --> N12[步骤 12]
    N12[步骤 12] --> N13[步骤 13]
    N13[步骤 13] --> N14[步骤 14]
    N14[步骤 14] --> N15[步骤 15]
    N15[步骤 15] --> N16[步骤 16]
```

流程图后紧跟的正文四：这一段必须从流程图所在页的下一页开始。

最后一段正文，用来确认文档末尾没有多余的空白页。
