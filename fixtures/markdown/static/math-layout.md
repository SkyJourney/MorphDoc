# 公式的结构性排版

下面这些公式靠 KaTeX 的内联样式完成定位与绘制，安全过滤器不得改变它们的显示。

字形重音符：$\vec{v}$、$\hat{x}$、$\bar{x}$、$\dot{x}$、$\tilde{x}$。

隐形占位（x 与 √2 应被隐藏，只留下空位）：$a\phantom{x}b$、$a\hphantom{\sqrt{2}}b$。

规则线：$a\rule{1em}{0.5em}b$、$a\rule[-0.2em]{2em}{0.1em}b$。

竖向省略号：$\vdots$

数组的列分隔线与横线：

$$
\begin{array}{c|c|c} a & b & c \\ \hline d & e & f \\ \hline g & h & i \end{array}
$$

虚线分隔：

$$
\begin{array}{c:c} a & b \\ \hdashline c & d \end{array}
$$
