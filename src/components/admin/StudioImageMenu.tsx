import type { Node as PMNode } from '@tiptap/pm/model';
import StudioContextMenu from './StudioContextMenu';
import type { ImageDetailDraft } from './StudioRichPopovers';
import type { StudioMenu } from './useStudioMenu';

interface Props {
  menu: StudioMenu<PMNode>;
  onReplace: (node: PMNode) => void;
  onDetail: (detail: ImageDetailDraft) => void;
  /** New attributes for the image, or null to delete it. */
  onChange: (node: PMNode, attrs: Record<string, unknown> | null) => void;
}

/** The ••• menu on an image in the rich editor. */
export default function StudioImageMenu({
  menu,
  onReplace,
  onDetail,
  onChange,
}: Props) {
  return (
    <StudioContextMenu
      open={menu.key !== null}
      label="Image actions"
      menuRef={menu.ref}
      position={menu.position}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          const node = menu.key;
          menu.close();
          if (node) onReplace(node);
        }}
      >
        Replace image
      </button>
      {(['caption', 'alt'] as const).map((field) => (
        <button
          type="button"
          role="menuitem"
          key={field}
          onClick={() => {
            const node = menu.key;
            menu.close();
            if (node) onDetail({ node, field, value: node.attrs[field] ?? '' });
          }}
        >
          {field === 'caption' ? 'Caption' : 'Alt text'}
        </button>
      ))}
      <div
        className="studio-image-align"
        role="group"
        aria-label="Image alignment"
      >
        {(['left', 'center', 'right'] as const).map((align) => (
          <button
            type="button"
            role="menuitemradio"
            key={align}
            aria-checked={
              (menu.key?.attrs.align === 'inline'
                ? 'left'
                : menu.key?.attrs.align) === align
            }
            onClick={() => {
              const node = menu.key;
              menu.close();
              if (node) onChange(node, { align });
            }}
          >
            {align.charAt(0).toUpperCase() + align.slice(1)}
          </button>
        ))}
      </div>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          const node = menu.key;
          menu.close();
          if (node) onChange(node, { widthPercent: 100 });
        }}
      >
        Full width
      </button>
      <div className="studio-menu-separator" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="is-danger"
        onClick={() => {
          const node = menu.key;
          menu.close();
          if (node) onChange(node, null);
        }}
      >
        Delete image
      </button>
    </StudioContextMenu>
  );
}
