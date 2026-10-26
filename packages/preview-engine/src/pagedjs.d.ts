declare module "pagedjs" {
  export interface PagedBreakToken {
    node?: Node;
    offset?: number;
  }

  export interface PagedPage {
    element: HTMLElement;
    startToken?: PagedBreakToken;
    endToken?: PagedBreakToken;
    destroy(): void;
  }

  export interface PagedFlow {
    total: number;
    pages: PagedPage[];
    performance: number;
    size: {
      width: { value: number; unit: string };
      height: { value: number; unit: string };
      format?: string;
      orientation?: string;
    };
  }

  export type PagedStylesheet = string | Record<string, string>;

  export class Previewer {
    chunker: {
      source: DocumentFragment;
      pages: PagedPage[];
      total: number;
      rendered: boolean;
      pagesArea: HTMLElement;
      hooks: {
        afterParsed: {
          trigger(
            parsed: DocumentFragment,
            chunker: unknown
          ): Promise<void>;
        };
        afterRendered: {
          trigger(
            pages: PagedPage[],
            chunker: unknown
          ): Promise<void>;
        };
      };
      loadFonts(): Promise<void>;
      removePages(fromIndex?: number): void;
      render(
        parsed: DocumentFragment,
        startAt?: PagedBreakToken
      ): Promise<{ done: boolean; canceled?: boolean }>;
      destroy(): void;
    };
    polisher: {
      destroy(): void;
    };
    preview(
      content?: HTMLElement | DocumentFragment | string,
      stylesheets?: PagedStylesheet[],
      renderTo?: HTMLElement | string
    ): Promise<PagedFlow>;
  }

  export class Handler {
    constructor(
      chunker: unknown,
      polisher: unknown,
      caller: unknown
    );
  }

  export function registerHandlers(
    ...handlers: Array<typeof Handler>
  ): void;
}
