export type PdfPageRenderTask = () => Promise<void>;

interface QueuedRender {
  id: symbol;
  pageNumber: number;
  run: PdfPageRenderTask;
  cancelled: boolean;
}

export class PdfPageRenderQueue {
  private readonly pending: QueuedRender[] = [];
  private readonly visiblePages = new Set<number>();
  private active = 0;
  private focusPage = 1;
  private scrollDirection: 1 | -1 = 1;
  private disposed = false;

  constructor(private readonly concurrency = 1) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error("PDF 页面渲染并发数必须是正整数");
    }
  }

  schedule(pageNumber: number, run: PdfPageRenderTask) {
    const task: QueuedRender = {
      id: Symbol(`pdf-page-${pageNumber}`),
      pageNumber,
      run,
      cancelled: false
    };
    this.pending.push(task);
    this.pump();

    return () => {
      task.cancelled = true;
      const index = this.pending.findIndex(
        (candidate) => candidate.id === task.id
      );
      if (index >= 0) {
        this.pending.splice(index, 1);
      }
    };
  }

  setVisible(pageNumber: number, visible: boolean) {
    if (visible) {
      if (pageNumber !== this.focusPage) {
        this.scrollDirection =
          pageNumber > this.focusPage ? 1 : -1;
        this.focusPage = pageNumber;
      }
      this.visiblePages.add(pageNumber);
    } else {
      this.visiblePages.delete(pageNumber);
    }
    this.pump();
  }

  dispose() {
    this.disposed = true;
    for (const task of this.pending) {
      task.cancelled = true;
    }
    this.pending.length = 0;
    this.visiblePages.clear();
  }

  private comparePriority(left: QueuedRender, right: QueuedRender) {
    const leftPriority = this.priority(left.pageNumber);
    const rightPriority = this.priority(right.pageNumber);
    return (
      leftPriority.group - rightPriority.group ||
      leftPriority.distance - rightPriority.distance ||
      left.pageNumber - right.pageNumber
    );
  }

  private priority(pageNumber: number) {
    if (this.visiblePages.has(pageNumber)) {
      return { group: 0, distance: 0 };
    }

    const delta = pageNumber - this.focusPage;
    const isAhead = delta * this.scrollDirection >= 0;
    return {
      group: isAhead ? 1 : 2,
      distance: Math.abs(delta)
    };
  }

  private pump() {
    if (this.disposed) {
      return;
    }

    while (this.active < this.concurrency) {
      this.pending.sort((left, right) =>
        this.comparePriority(left, right)
      );
      const task = this.pending.shift();
      if (!task) {
        return;
      }
      if (task.cancelled) {
        continue;
      }

      this.active += 1;
      void task
        .run()
        .catch(() => undefined)
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }
}
