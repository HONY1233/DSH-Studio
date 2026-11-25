/**
 * 顶栏 —— 工作台标题 + 面板菜单。
 *
 * 菜单只在打开时读一次注册表（`PanelRegistry` 没有订阅接口）。这样动态注册的
 * 面板下次打开菜单就能看到，不必为它引入一条全局变更通知。
 *
 * 菜单两段式：点面板名 = 按它声明的 `defaultRegion` 打开（常用路径一次点击）；
 * 点右边的 ▾ 才展开"放哪"——只列该面板 `regions` 里声明过的区域，
 * 没声明的（比如只允许浮窗的面板）不会出现在这里。
 */

import { useState, type CSSProperties, type ReactNode } from 'react'

import { PLACEMENT_LABELS, type Placement } from '../ui-workbench/index.js'
import type { PanelContribution, PanelRegistry } from '../ui-panel-host/index.js'

export interface TopbarLabels {
  readonly workspace: string
  readonly panels: string
  readonly empty: string
  readonly chooseRegion: (title: string) => string
  /** 「默认」按钮的文案与 title。传空串时给按钮上的短文案。 */
  readonly useDefault: (title: string) => string
}

export const defaultTopbarLabels: TopbarLabels = {
  workspace: '工作台',
  panels: '面板',
  empty: '还没有可用面板',
  chooseRegion: (title) => `选择「${title}」放哪`,
  useDefault: (title) => (title === '' ? '默认' : `「${title}」不再记住位置，按面板默认打开`),
}

const bar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '6px 10px',
  borderBottom: '1px solid var(--color-border-tertiary, rgba(0,0,0,.07))',
  fontSize: 12,
  color: 'var(--color-text-secondary, #5f5e5a)',
  position: 'relative',
}

const item: CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 10px',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  fontSize: 12,
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  borderRadius: 6,
}

export interface StudioTopbarProps {
  readonly panels: PanelRegistry
  /**
   * 打开面板。
   *
   * 第二参数缺省表示"按记忆 / 面板声明的 defaultRegion 打开"——常用路径不该被迫做选择。
   * `options.remember === false` 表示"这次的选择不要记下来，并把旧记忆清掉"。
   */
  readonly onOpenPanel: (
    panelId: string,
    placement?: Placement,
    options?: { readonly remember?: boolean },
  ) => void
  /**
   * 这个面板下次会放哪（记忆优先）。
   *
   * 菜单要把结果显示出来：不显示的话"记住上次位置"会变成静默行为 ——
   * 用户点了面板名，结果它跑到别处去了，而菜单上没有任何交代。
   */
  readonly regionOf?: (panelId: string) => { readonly placement: Placement; readonly remembered: boolean }
  readonly sessionCount?: number
  readonly labels?: TopbarLabels
}

export function StudioTopbar(props: StudioTopbarProps): ReactNode {
  const labels = props.labels ?? defaultTopbarLabels
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<readonly PanelContribution[]>([])
  /** 展开"放哪"的面板 id；同时只展开一个，避免菜单变成一堆按钮墙。 */
  const [choosing, setChoosing] = useState<string | undefined>(undefined)

  const toggle = (): void => {
    if (!open) setList(props.panels.list())
    setChoosing(undefined)
    setOpen(!open)
  }

  const close = (): void => {
    setOpen(false)
    setChoosing(undefined)
  }

  return (
    <div style={bar} data-testid="studio-topbar">
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontWeight: 500, color: 'var(--color-text-primary, #2c2c2a)' }}>{labels.workspace}</span>
        {props.sessionCount !== undefined && props.sessionCount > 0 && (
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary, #8a8a85)' }}>
            {props.sessionCount} 场会话
          </span>
        )}
      </span>

      <span style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={toggle}
          data-testid="studio-panel-menu-button"
          aria-haspopup="menu"
          aria-expanded={open}
          style={{
            padding: '3px 9px',
            borderRadius: 6,
            border: '1px solid var(--color-border-secondary, rgba(0,0,0,.12))',
            background: 'var(--color-background-secondary, #fff)',
            color: 'inherit',
            fontSize: 11,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          {labels.panels}
        </button>

        {open && (
          <>
            {/* 点击外部关闭：透明遮罩比 document 监听更省事，也不会漏掉 iframe 边角 */}
            <div
              onClick={() => setOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 40 }}
              aria-hidden="true"
            />            <div
              role="menu"
              data-testid="studio-panel-menu"
              style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                marginTop: 4,
                minWidth: 180,
                padding: 4,
                borderRadius: 8,
                border: '1px solid var(--color-border-secondary, rgba(0,0,0,.12))',
                background: 'var(--color-background-primary, #fff)',
                boxShadow: '0 6px 20px rgba(0,0,0,.12)',
                zIndex: 41,
              }}
            >
              {list.length === 0 ? (
                <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--color-text-tertiary, #8a8a85)' }}>
                  {labels.empty}
                </div>
              ) : (
                list.map((contribution) => {
                  const expanded = choosing === contribution.id
                  const region = props.regionOf?.(contribution.id)
                  return (
                    <div
                      key={contribution.id}
                      data-testid="studio-panel-menu-row"
                      data-panel-id={contribution.id}
                    >
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <button
                          type="button"
                          role="menuitem"
                          data-testid="studio-panel-menu-item"
                          data-panel-id={contribution.id}
                          style={{ ...item, flex: '1 1 auto', minWidth: 0 }}
                          onClick={() => {
                            close()
                            props.onOpenPanel(contribution.id)
                          }}
                          onMouseEnter={(event) => {
                            event.currentTarget.style.background = 'var(--color-background-tertiary, rgba(0,0,0,.05))'
                          }}
                          onMouseLeave={(event) => {
                            event.currentTarget.style.background = 'transparent'
                          }}
                        >
                          <span
                            style={{
                              display: 'block',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {contribution.title.zh}
                            {region && (
                              <span
                                data-testid="studio-panel-region-hint"
                                data-remembered={region.remembered ? 'true' : 'false'}
                                style={{
                                  marginLeft: 6,
                                  fontSize: 10,
                                  fontWeight: 400,
                                  color: region.remembered
                                    ? 'var(--color-text-link, #2f6fb3)'
                                    : 'var(--color-text-tertiary, #8a8a85)',
                                }}
                              >
                                {PLACEMENT_LABELS[region.placement]}
                              </span>
                            )}
                          </span>
                        </button>
                        <button
                          type="button"
                          data-testid="studio-panel-region-toggle"
                          data-panel-id={contribution.id}
                          aria-expanded={expanded}
                          aria-label={labels.chooseRegion(contribution.title.zh)}
                          onClick={() => setChoosing(expanded ? undefined : contribution.id)}
                          style={{
                            flex: '0 0 auto',
                            padding: '6px 6px',
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--color-text-tertiary, #8a8a85)',
                            fontSize: 10,
                            fontFamily: 'inherit',
                            cursor: 'pointer',
                            borderRadius: 6,
                          }}
                        >
                          {expanded ? '▴' : '▾'}
                        </button>
                      </div>

                      {expanded && (
                        <div
                          data-testid="studio-panel-regions"
                          style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '2px 10px 6px 10px' }}
                        >
                          {contribution.regions.map((option) => (
                            <button
                              key={option}
                              type="button"
                              data-testid="studio-panel-region"
                              data-region={option}
                              data-current={region?.remembered && region.placement === option ? 'true' : undefined}
                              onClick={() => {
                                close()
                                props.onOpenPanel(contribution.id, option)
                              }}
                              style={{
                                padding: '2px 8px',
                                borderRadius: 5,
                                border: `1px solid ${
                                  region?.remembered && region.placement === option
                                    ? 'var(--color-border-info, #2f6fb3)'
                                    : 'var(--color-border-tertiary, rgba(0,0,0,.1))'
                                }`,
                                background: 'var(--color-background-secondary, #f7f6f2)',
                                color: 'var(--color-text-secondary, #55554f)',
                                fontSize: 11,
                                fontFamily: 'inherit',
                                cursor: 'pointer',
                              }}
                            >
                              {PLACEMENT_LABELS[option]}
                            </button>
                          ))}
                          {region?.remembered && (
                            <button
                              type="button"
                              data-testid="studio-panel-region-reset"
                              title={labels.useDefault(contribution.title.zh)}
                              onClick={() => {
                                close()
                                // 不传 placement 且明确"不要记" → 回到面板声明的默认区域
                                props.onOpenPanel(contribution.id, undefined, { remember: false })
                              }}
                              style={{
                                padding: '2px 8px',
                                borderRadius: 5,
                                border: '1px dashed var(--color-border-tertiary, rgba(0,0,0,.18))',
                                background: 'transparent',
                                color: 'var(--color-text-tertiary, #8a8a85)',
                                fontSize: 11,
                                fontFamily: 'inherit',
                                cursor: 'pointer',
                              }}
                            >
                              {labels.useDefault('')}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </>
        )}
      </span>
    </div>
  )
}
