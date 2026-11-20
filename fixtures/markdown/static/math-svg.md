# 带 SVG 的公式

KaTeX 用内联 SVG 绘制下面这些元素，安全过滤器必须保留它们。

根号：$\sqrt{x}$、$\sqrt[3]{x^2+1}$、$\sqrt{\frac{a}{b}}$。

箭头：$A \xrightarrow{heat} B$ 与 $A \xleftarrow[down]{up} B$。

重音：$\widehat{ABC}$、$\widetilde{ABC}$、$\vec{v}$、$\overrightarrow{AB}$。

上下括号：$\overbrace{a+b+c}^{n}$、$\underbrace{a+b+c}_{n}$。

划线：$\cancel{x}$、$\bcancel{x}$、$\xcancel{x}$。

拉伸的大括号（普通的 `\Big(` 用字体字形绘制，不产生 SVG）：

$$
\left\{ \begin{array}{c} a \\ b \\ c \\ d \end{array} \right.
$$
