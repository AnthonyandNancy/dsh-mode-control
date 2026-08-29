export const CAPABILITIES_CSS = `
.dsh-mc-root{width:100%;min-width:0;color:var(--dsw-alias-label-primary);flex-direction:column;gap:24px;display:flex;box-sizing:border-box}
.dsh-mc-title{color:var(--dsw-alias-label-primary);margin:0;font-size:17px;font-weight:600;line-height:24px}
.dsh-mc-intro{color:var(--dsw-alias-label-tertiary);margin:-12px 0 0;font-size:13px;line-height:20px}
.dsh-mc-section{min-width:0;display:flex;flex-direction:column;gap:2px}
.dsh-mc-section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:0 0 5px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-mc-section-title{color:var(--dsw-alias-label-primary);margin:0;font-size:14px;font-weight:600;line-height:22px}

/* Depth scale: 0 / 16px / 32px, no cumulative margins. */
.dsh-mc-depth-0{--dsh-mc-indent:0px}
.dsh-mc-depth-1{--dsh-mc-indent:16px}
.dsh-mc-depth-2{--dsh-mc-indent:32px}
@media (max-width:520px){
  .dsh-mc-depth-1{--dsh-mc-indent:12px}
  .dsh-mc-depth-2{--dsh-mc-indent:24px}
}

/* Panels are plain native-settings modules, not plugin cards. */
.dsh-mc-panel{min-width:0;border:0;border-radius:0;padding:0;background:transparent;display:flex;flex-direction:column;gap:16px;box-sizing:border-box}
.dsh-mc-panel-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;min-width:0}
.dsh-mc-panel-title{color:var(--dsw-alias-label-primary);margin:0;font-size:15px;font-weight:600;line-height:22px}
.dsh-mc-panel-action{flex:none;display:flex;align-items:center;justify-content:flex-end;min-width:0}
.dsh-mc-panel-caption{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:-8px 0 0}
.dsh-mc-panel-body{min-width:0;display:flex;flex-direction:column;gap:16px}
.dsh-mc-subsection{min-width:0;display:flex;flex-direction:column;gap:8px}
.dsh-mc-subsection-title{color:var(--dsw-alias-label-primary);margin:0;padding-left:0;font-size:13px;font-weight:600;line-height:20px}
.dsh-mc-subsection + .dsh-mc-subsection{border-top:1px solid var(--dsw-alias-border-l2);padding-top:14px;margin-top:14px}
.dsh-mc-subsection-body{min-width:0;display:flex;flex-direction:column;padding-left:12px;gap:4px}
.dsh-mc-subagent-description{margin:-4px 0 0}
.dsh-mc-section-caption{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}

/* Setting rows: native settings rhythm + hairline; nested rows stay compact. */
.dsh-mc-setting-rows{display:flex;flex-direction:column;min-width:0}
.dsh-mc-setting-row{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.dsh-mc-setting-row-density-settings{min-height:48px;padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-mc-setting-row-density-nested{min-height:34px;padding:2px 0;border-bottom:0}
.dsh-mc-setting-row-depth-0{--dsh-mc-indent:0px;padding-inline-start:0px}
.dsh-mc-setting-row-depth-1{--dsh-mc-indent:16px;padding-inline-start:16px}
.dsh-mc-setting-row-depth-2{--dsh-mc-indent:32px;padding-inline-start:32px}
@media (max-width:520px){
  .dsh-mc-setting-row-depth-1{padding-inline-start:12px}
  .dsh-mc-setting-row-depth-2{padding-inline-start:24px}
}
.dsh-mc-setting-label-block{min-width:0;display:flex;flex:1;flex-direction:column;gap:2px}
.dsh-mc-setting-label-line{min-width:0;display:flex;align-items:center;gap:6px}
.dsh-mc-setting-label{color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;font-weight:400}
.dsh-mc-setting-row-density-nested .dsh-mc-setting-label{font-size:13px;line-height:20px;font-weight:500}
.dsh-mc-setting-help{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;cursor:help;flex:none;display:inline-flex;align-items:center}
.dsh-mc-info-icon{display:block;flex:none}
.dsh-mc-setting-description,.dsh-mc-setting-warning{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dsh-mc-setting-warning{color:var(--dsw-alias-state-warn-label)}
.dsh-mc-setting-control{flex:none;display:flex;align-items:center;justify-content:flex-end;min-width:0}
.dsh-mc-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin:4px 0}
.dsh-mc-error{color:var(--dsw-alias-danger-default);font-size:13px;line-height:18px;margin:0}.dsh-mc-feedback{display:flex;align-items:center;gap:8px}
.dsh-mc-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:18px}

/* Chips are dense settings pills. */
.dsh-mc-chips{flex-wrap:wrap;gap:6px;display:flex;justify-content:flex-end}
.dsh-mc-chip{box-sizing:border-box;height:28px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);border-radius:14px;padding:0 10px;font-size:12px;line-height:18px;font-weight:400;cursor:pointer}
.dsh-mc-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mc-chip-active{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-primary-default);color:var(--dsw-alias-primary-default);font-weight:500}

/* DSH settings controls: 32px / 8px radius / 14px label. */
.dsh-mc-input,.dsh-mc-textarea,.dsh-mc-inline-input,.dsh-mc-picker-search{box-sizing:border-box;height:32px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:4px 10px;font-size:14px;line-height:22px;font-weight:400}
.dsh-mc-textarea{height:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical;min-height:80px;max-height:160px;width:100%;overflow:auto;line-height:20px}
.dsh-mc-inline-input{width:140px}
.dsh-mc-inline-value{box-sizing:border-box;height:32px;min-width:80px;max-width:220px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;font-size:14px;line-height:22px;cursor:pointer;text-align:right;display:inline-flex;align-items:center;justify-content:flex-end}
.dsh-mc-inline-value:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mc-input:focus,.dsh-mc-textarea:focus,.dsh-mc-inline-input:focus,.dsh-mc-inline-value:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}

/* Buttons: DSH pill system. */
.dsh-mc-button{box-sizing:border-box;border:0;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;font-weight:500}
.dsh-mc-button-primary{height:36px;padding:0 14px;border-radius:18px;font-size:14px;line-height:22px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.dsh-mc-button-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dsh-mc-button-secondary{height:36px;padding:0 14px;border-radius:18px;font-size:14px;line-height:22px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}
.dsh-mc-button-secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsh-mc-button-dense{height:28px;padding:0 10px;border-radius:14px;font-size:12px;line-height:18px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}
.dsh-mc-button-dense:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
.dsh-mc-button:disabled{opacity:.55;cursor:default}
.dsh-mc-button:disabled:hover{background:transparent}
.dsh-mc-button:focus-visible,.dsh-mc-link-button:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.dsh-mc-link-button{background:none;border:none;color:var(--dsw-alias-primary-default);font-size:13px;line-height:20px;font-weight:500;cursor:pointer;padding:0}
.dsh-mc-link-button:hover{text-decoration:underline}

/* Select / picker trigger: identical settings chrome. */
.dsh-mc-compact-select{position:relative;min-width:0}
.dsh-mc-compact-trigger,.dsh-mc-picker-trigger{box-sizing:border-box;height:32px;min-height:32px;max-width:240px;color:var(--dsw-alias-label-primary);cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);align-items:center;gap:8px;padding:0 32px 0 10px;font-size:14px;line-height:22px;font-weight:400;display:flex;outline:none}
.dsh-mc-compact-trigger:hover:not(:disabled),.dsh-mc-picker-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mc-compact-trigger:focus-visible,.dsh-mc-picker-trigger:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.dsh-mc-compact-trigger-label,.dsh-mc-picker-trigger-label{white-space:nowrap;text-overflow:ellipsis;overflow:hidden;min-width:0;flex:1}
.dsh-mc-compact-trigger .dsh-mc-icon,.dsh-mc-picker-trigger .dsh-mc-icon{flex:none}
.dsh-mc-compact-menu,.dsh-mc-picker-menu{z-index:20;border:1px solid var(--dsw-alias-border-inverted);background:var(--dsw-specific-menu);min-width:min(240px,calc(100vw - 32px));max-width:min(420px,calc(100vw - 32px));max-height:min(360px,calc(100vh - 96px));box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);border-radius:12px;padding:4px;display:flex;flex-direction:column;position:absolute;top:calc(100% + 8px);right:0;overflow:hidden;box-sizing:border-box}
.dsh-mc-compact-option{width:100%;min-height:38px;padding:6px 8px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;text-align:left;outline:none}
.dsh-mc-compact-option:hover,.dsh-mc-picker-option:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mc-compact-check,.dsh-mc-picker-check{flex:0 0 16px;width:16px;height:16px;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;justify-content:center}
.dsh-mc-icon{display:block;flex:none;color:currentColor}
.dsh-mc-icon-open{transform:rotate(180deg)}

/* Disclosure hierarchy: variant = semantics, depth = absolute indent. */
.dsh-mc-disclosure-row{min-width:0}
.dsh-mc-disclosure-row-variant-section{border-bottom:1px solid var(--dsw-alias-border-l2)}
.dsh-mc-disclosure-trigger{width:100%;min-height:40px;padding:4px 0;box-sizing:border-box;padding-inline-start:var(--dsh-mc-indent,0px);border:0;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;align-items:center;gap:8px;text-align:left;font-size:13px;line-height:20px;outline:none}
.dsh-mc-disclosure-trigger:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-mc-disclosure-trigger:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.dsh-mc-disclosure-label{min-width:0;flex:1}
.dsh-mc-disclosure-value{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dsh-mc-disclosure-chevron{color:var(--dsw-alias-label-caption);display:flex}
.dsh-mc-disclosure-description{padding-inline-start:var(--dsh-mc-indent,0px)}
.dsh-mc-disclosure-content{padding:2px 0 10px;display:flex;flex-direction:column;gap:2px}
.dsh-mc-disclosure-fields,.dsh-mc-compat-group{display:flex;flex-direction:column;min-width:0}
.dsh-mc-compat-group-title{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600;line-height:18px;margin:0;padding:2px 0 4px;padding-inline-start:var(--dsh-mc-indent,0px)}
.dsh-mc-disclosure-row-variant-section .dsh-mc-disclosure-trigger{font-size:13px;font-weight:600}
.dsh-mc-disclosure-row-variant-section .dsh-mc-disclosure-value{color:var(--dsw-alias-label-secondary)}
.dsh-mc-disclosure-row-variant-group{border-bottom:1px solid var(--dsw-alias-border-l3)}
.dsh-mc-disclosure-row-variant-group .dsh-mc-disclosure-trigger{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);min-height:36px}
.dsh-mc-disclosure-row-variant-group .dsh-mc-disclosure-value{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsh-mc-disclosure-row-variant-group .dsh-mc-disclosure-content{padding:2px 0 10px 0}
.dsh-mc-disclosure-row-variant-field .dsh-mc-disclosure-trigger{font-size:13px;font-weight:400;color:var(--dsw-alias-label-primary)}
.dsh-mc-disclosure-row-variant-field .dsh-mc-disclosure-content{padding-inline-start:var(--dsh-mc-indent,0px)}
.dsh-mc-json-editor{width:100%;display:flex;flex-direction:column;gap:6px;background:var(--dsw-alias-bg-module-platform);border-radius:12px;padding:10px;box-sizing:border-box}
.dsh-mc-compat-control{display:flex;align-items:center;gap:6px;min-width:0}
.dsh-mc-picker-root{position:relative;min-width:0}
.dsh-mc-picker-menu{top:calc(100% + 8px)}
.dsh-mc-picker-menu-up{top:auto;bottom:calc(100% + 8px)}
.dsh-mc-picker-search{width:100%;margin-bottom:4px}
.dsh-mc-picker-listbox{min-width:0;min-height:0;display:flex;flex:1;overflow:hidden}.dsh-mc-picker-groups{min-width:0;min-height:0;flex:1;overflow:auto}
.dsh-mc-picker-group{padding:0 0 4px}
.dsh-mc-picker-group-title{position:sticky;top:0;z-index:1;padding:6px 8px 4px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;background:var(--dsw-specific-menu)}
.dsh-mc-picker-option{box-sizing:border-box;width:100%;min-height:38px;padding:6px 8px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;text-align:left;outline:none}
.dsh-mc-picker-option:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.dsh-mc-picker-option-copy{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}
.dsh-mc-picker-model{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-mc-picker-detail{color:var(--dsw-alias-label-tertiary);font-size:12px}
.dsh-mc-picker-empty{color:var(--dsw-alias-label-tertiary);padding:10px 8px;font-size:13px}
.dsh-mc-mode{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-weight:400}
.dsh-mc-mode-native{color:var(--dsw-alias-success-default)}
.dsh-mc-mode-legacy{color:var(--dsw-alias-state-warn-label)}
.dsh-mc-action-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:6px;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l2)}
.dsh-mc-action-feedback{min-height:20px;flex:1;display:flex;align-items:center}
.dsh-mc-action-buttons{display:flex;gap:8px;flex:none}
.dsh-mc-save-feedback{display:inline-flex;align-items:center;gap:6px;font-size:13px;line-height:20px}
.dsh-mc-save-feedback-saving{color:var(--dsw-alias-label-secondary)}
.dsh-mc-save-feedback-success{color:var(--dsw-alias-success-default)}
.dsh-mc-save-feedback-pending{color:var(--dsw-alias-state-warn-label)}
.dsh-mc-save-feedback-error{color:var(--dsw-alias-danger-default)}
.dsh-mc-save-icon{display:flex}
@media (max-width:520px){.dsh-mc-setting-row{align-items:flex-start;gap:8px}.dsh-mc-setting-label-block{padding-top:4px}.dsh-mc-compact-trigger,.dsh-mc-picker-trigger{max-width:200px}.dsh-mc-chips{justify-content:flex-start}.dsh-mc-action-row{flex-wrap:wrap}.dsh-mc-action-buttons{margin-left:auto}}
`
