{
  "product": {
    "name": "JKEE EPC ERP",
    "design_personality": [
      "dense operations workspace",
      "trustworthy enterprise",
      "fast data entry",
      "Indian EPC domain-native",
      "high-contrast, low-decoration",
      "themeable per company (runtime CSS variables)"
    ],
    "non_negotiables": [
      "Left sidebar for M1–M15 modules",
      "Top bar with company switcher + global search + approvals/alerts",
      "Tables optimized for heavy data entry (compact density)",
      "Solid backgrounds only (no transparency/glass)",
      "Indian formats: ₹ 12,34,567 and DD-MM-YYYY",
      "All interactive + key informational elements must include data-testid (kebab-case)",
      "React + Tailwind + shadcn/ui + lucide-react + recharts",
      "Theme must be runtime-switchable per company via CSS variables"
    ]
  },

  "brand_theming_runtime": {
    "company_palette_contract": {
      "description": "Each company provides exactly 3 colors that reskin shell, surfaces, and action accents.",
      "css_variables": {
        "--brand-primary": "company preset primary",
        "--brand-surface": "company preset surface",
        "--brand-accent": "company preset accent"
      },
      "presets": {
        "ocean-instinct": {
          "--brand-primary": "#20309A",
          "--brand-surface": "#FFFFFF",
          "--brand-accent": "#BB232B"
        },
        "flora-verse": {
          "--brand-primary": "#9B7ED6",
          "--brand-surface": "#F3E6D7",
          "--brand-accent": "#E4FF3B"
        },
        "beyond-limits": {
          "--brand-primary": "#17191C",
          "--brand-surface": "#929DA7",
          "--brand-accent": "#FF4B32"
        },
        "impact-dark": {
          "--brand-primary": "#1C1D20",
          "--brand-surface": "#F2F4F1",
          "--brand-accent": "#FFC928"
        },
        "higher-perspective": {
          "--brand-primary": "#0B3048",
          "--brand-surface": "#F2F0E9",
          "--brand-accent": "#B9F12F"
        },
        "modern-living": {
          "--brand-primary": "#8DB9F0",
          "--brand-surface": "#E9E8F8",
          "--brand-accent": "#F5B69E"
        }
      }
    },

    "design_tokens_css": {
      "instructions": "Main agent should implement these as CSS custom properties in index.css :root and update shadcn tokens to reference them. Keep solid backgrounds only.",
      "tokens": {
        "--app-bg": "#F6F7F9",
        "--app-fg": "#0B1220",
        "--panel-bg": "var(--brand-surface)",
        "--panel-fg": "#0B1220",
        "--sidebar-bg": "#0E1424",
        "--sidebar-fg": "#E9EEF7",
        "--sidebar-muted": "rgba(233,238,247,0.72)",

        "--border-subtle": "#E3E7EF",
        "--border-strong": "#CBD3E1",

        "--focus-ring": "var(--brand-primary)",
        "--link": "var(--brand-primary)",

        "--action-primary": "var(--brand-primary)",
        "--action-primary-fg": "#FFFFFF",
        "--action-accent": "var(--brand-accent)",

        "--radius-sm": "8px",
        "--radius-md": "10px",
        "--radius-lg": "12px",

        "--shadow-1": "0 1px 0 rgba(16,24,40,0.04), 0 1px 2px rgba(16,24,40,0.06)",
        "--shadow-2": "0 8px 24px rgba(16,24,40,0.10)",

        "--table-row-h-compact": "36px",
        "--table-row-h-comfy": "44px",
        "--table-cell-px": "12px",
        "--table-cell-py": "8px",

        "--status-success": "#1F8A5B",
        "--status-warning": "#B7791F",
        "--status-danger": "#B42318",
        "--status-info": "#175CD3",
        "--status-neutral": "#667085"
      },
      "contrast_guard": {
        "rule": "If --brand-primary is too light for white text, switch primary button text to #0B1220 and add 1px border using --border-strong.",
        "implementation_hint": "Compute luminance in JS when company switches; set --action-primary-fg accordingly. Keep it deterministic and cached per company."
      }
    }
  },

  "typography": {
    "google_fonts": {
      "heading": {
        "family": "Space Grotesk",
        "weights": [500, 600, 700]
      },
      "body": {
        "family": "Inter",
        "weights": [400, 500, 600]
      },
      "numeric": {
        "family": "IBM Plex Mono",
        "weights": [400, 500]
      }
    },
    "tailwind_usage": {
      "app_default": "font-sans text-[13px] sm:text-sm leading-5",
      "h1": "text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight",
      "h2": "text-base md:text-lg font-medium text-muted-foreground",
      "page_title": "text-lg sm:text-xl font-semibold tracking-tight",
      "section_title": "text-sm font-semibold text-foreground",
      "table_header": "text-[11px] uppercase tracking-wide text-muted-foreground",
      "table_cell": "text-[13px] leading-5",
      "numbers": "font-mono tabular-nums"
    }
  },

  "layout_system": {
    "shell": {
      "desktop": {
        "pattern": "Sidebar (fixed) + Topbar (sticky) + Content (scrollable)",
        "sidebar_width": "w-[272px] (expanded), w-[72px] (collapsed rail)",
        "topbar_height": "h-12",
        "content_padding": "px-4 py-3 (listing pages), px-5 py-4 (detail pages)"
      },
      "page_header_pattern": {
        "structure": [
          "Row 1: Breadcrumb (left) + page actions (right)",
          "Row 2: Title + subtitle (left) + view switcher / density toggle (right)",
          "Row 3 (optional): Filter chips strip + search"
        ],
        "sticky": "Make Row 1 sticky on long tables; keep filters in a secondary sticky bar only when needed."
      },
      "grid": {
        "dashboard": "12-col grid on lg; use 1-col on mobile, 2-col on md",
        "kpi_strip": "grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3",
        "split_views": "Use shadcn Resizable for WBS/Gantt and AI Reader split panes"
      }
    },

    "density": {
      "principle": "Default to compact; allow user toggle to comfortable.",
      "controls": "Top-right of listing pages: ToggleGroup (Compact/Comfortable) + Column visibility menu",
      "compact_defaults": {
        "inputs": "h-9",
        "buttons": "h-9",
        "table_row": "var(--table-row-h-compact)",
        "form_spacing": "gap-3"
      }
    }
  },

  "component_path": {
    "primary": [
      "/app/frontend/src/components/ui/button.jsx",
      "/app/frontend/src/components/ui/badge.jsx",
      "/app/frontend/src/components/ui/table.jsx",
      "/app/frontend/src/components/ui/tabs.jsx",
      "/app/frontend/src/components/ui/dialog.jsx",
      "/app/frontend/src/components/ui/drawer.jsx",
      "/app/frontend/src/components/ui/sheet.jsx",
      "/app/frontend/src/components/ui/dropdown-menu.jsx",
      "/app/frontend/src/components/ui/command.jsx",
      "/app/frontend/src/components/ui/select.jsx",
      "/app/frontend/src/components/ui/checkbox.jsx",
      "/app/frontend/src/components/ui/calendar.jsx",
      "/app/frontend/src/components/ui/scroll-area.jsx",
      "/app/frontend/src/components/ui/resizable.jsx",
      "/app/frontend/src/components/ui/sonner.jsx",
      "/app/frontend/src/components/ui/tooltip.jsx",
      "/app/frontend/src/components/ui/separator.jsx",
      "/app/frontend/src/components/ui/breadcrumb.jsx",
      "/app/frontend/src/components/ui/pagination.jsx"
    ],
    "patterns_to_build_using_shadcn": {
      "app_shell": "Compose with divs + ScrollArea; keep sidebar + topbar consistent across modules.",
      "approvals_inbox": "Tabs + Table + Badge + DropdownMenu row actions.",
      "company_wizard": "Tabs or Stepper-like pattern using Tabs + Card + Form; use Dialog for confirmations.",
      "split_screen_ai_reader": "Resizable (left: document viewer, right: extracted fields + confidence badges).",
      "vendor_secure_link_pages": "Minimal shell (no sidebar), topbar with company branding + status badge + CTA.",
      "client_portal_read_only": "Same shell but hide create/edit actions; show watermark badge 'Read-only'.",
      "mobile": "Bottom nav (custom) + one-task-per-screen; use Drawer for filters."
    }
  },

  "tables_and_data_entry": {
    "table_principles": [
      "Sticky header + optional sticky first column for identifiers (Tender ID / Project Code / Vendor)",
      "Row hover reveals quick actions (View/Edit/More) without shifting layout",
      "Numeric columns right-aligned + font-mono tabular-nums",
      "Inline edit only for 1–2 fields; full edit in Drawer/Sheet",
      "Always show record count + last sync timestamp in header",
      "Column visibility + density toggle are mandatory on heavy tables"
    ],
    "table_toolbar": {
      "left": ["Title", "Count", "Saved view selector"],
      "middle": ["Search input", "Filter chips"],
      "right": ["Primary action button", "Columns dropdown", "Density toggle", "Export"]
    },
    "cell_styles_tailwind": {
      "header_cell": "h-9 px-3 text-[11px] uppercase tracking-wide text-muted-foreground",
      "body_cell": "px-3 py-2 text-[13px]",
      "row": "h-[var(--table-row-h-compact)] hover:bg-muted/40",
      "number": "text-right font-mono tabular-nums",
      "code": "font-mono text-[12px]"
    },
    "status_badges": {
      "use": "Badge component; keep solid fills (no gradients).",
      "mapping": {
        "success": "bg-[color:var(--status-success)] text-white",
        "warning": "bg-[color:var(--status-warning)] text-white",
        "danger": "bg-[color:var(--status-danger)] text-white",
        "info": "bg-[color:var(--status-info)] text-white",
        "neutral": "bg-[color:var(--status-neutral)] text-white"
      },
      "domain_examples": {
        "tenders": {
          "draft": "neutral",
          "submitted": "info",
          "clarification": "warning",
          "won": "success",
          "lost": "danger"
        },
        "billing": {
          "pending": "warning",
          "approved": "success",
          "rejected": "danger",
          "posted": "info"
        }
      }
    }
  },

  "key_screens_layout_specs": {
    "company_launchpad": {
      "layout": "Card grid with company tiles + recent projects + approvals summary.",
      "components": ["Card", "Badge", "Button", "Tabs"],
      "micro_interactions": [
        "Company tile hover: elevate shadow-1 -> shadow-2 (no transform transition-all)",
        "Company switch: toast via sonner + subtle skeleton loading"
      ],
      "data_testids": [
        "company-launchpad-company-card",
        "company-launchpad-switch-company-button",
        "company-launchpad-approvals-link"
      ]
    },

    "tender_pipeline": {
      "layout": "Split: left Kanban (stages) + right Table (selected stage) on desktop; Tabs (Kanban/Table) on mobile.",
      "components": ["Tabs", "Card", "Table", "Badge", "DropdownMenu"],
      "notes": "Kanban cards must show Tender ID, client, value (₹), due date (DD-MM-YYYY), and RAG badge."
    },

    "quotes_comparison_matrix": {
      "layout": "Wide scroll matrix table with sticky first column (items) and sticky header (vendors).",
      "components": ["Table", "ScrollArea", "Tooltip"],
      "interaction": "Cell click opens Drawer with vendor quote breakdown + attachments."
    },

    "wbs_gantt": {
      "layout": "Resizable split: left WBS tree (30–40%) + right Gantt (60–70%). Bottom panel toggles S-curve / Budget vs Actual.",
      "components": ["Resizable", "Tabs", "Card", "Separator"],
      "charts": {
        "library": "recharts",
        "patterns": [
          "S-curve: planned vs actual cumulative lines",
          "Budget vs actual: grouped bars + variance line"
        ]
      }
    },

    "split_screen_ai_reader": {
      "layout": "Resizable: left document viewer (PDF/image) + right extracted fields table.",
      "confidence_badges": {
        "rule": "Show confidence as Badge with 3 levels: High/Med/Low; never show raw % unless user expands.",
        "colors": {
          "high": "success",
          "med": "warning",
          "low": "danger"
        }
      },
      "components": ["Resizable", "Table", "Badge", "Tabs", "Tooltip"],
      "micro_interactions": [
        "Hover extracted field highlights corresponding region in doc (outline only)",
        "Click badge opens Popover with rationale + source snippet"
      ]
    },

    "closure_gate_checklist": {
      "layout": "11-point checklist with left progress rail + right evidence uploader.",
      "components": ["Checkbox", "Progress", "Card", "Dialog"],
      "interaction": "Checking an item prompts for evidence in Drawer; show completion % in header."
    },

    "approvals_inbox": {
      "layout": "Tabs by type (PO, RA Bill, JV, HR) + table with bulk select + right-side preview sheet.",
      "components": ["Tabs", "Table", "Checkbox", "Sheet", "Badge"],
      "interaction": "Bulk approve requires AlertDialog confirmation."
    },

    "calendar": {
      "rule": "Use shadcn Calendar component; do not implement custom calendar.",
      "components": ["/app/frontend/src/components/ui/calendar.jsx"]
    }
  },

  "navigation": {
    "sidebar": {
      "structure": {
        "top": "Company logo + compact company switcher",
        "middle": "Module list M1–M15 grouped (Tendering, Delivery, Finance, Governance)",
        "bottom": "User menu + Settings + Collapse"
      },
      "module_labels": {
        "format": "M1 Tenders … M15 Alerts",
        "rule": "Always show module code prefix for EPC familiarity and faster scanning."
      },
      "active_state": "Solid left border 3px in --brand-accent + subtle bg tint (no gradients).",
      "hover_state": "Background tint using muted; keep text readable.",
      "data_testids": {
        "sidebar": "app-sidebar",
        "company_switcher": "topbar-company-switcher",
        "module_item": "sidebar-module-nav-item"
      }
    },

    "topbar": {
      "left": ["Breadcrumb", "Project selector (when inside a project)"] ,
      "center": ["Global search (Command palette)"] ,
      "right": ["Approvals", "Alerts", "Help", "User menu"],
      "components": ["Breadcrumb", "Command", "DropdownMenu", "Button", "Badge"],
      "micro_interactions": [
        "Cmd+K opens Command palette",
        "Alerts bell shows unread count badge",
        "Company switch triggers 150–250ms skeleton on main content"
      ]
    }
  },

  "motion_microinteractions": {
    "principles": [
      "No universal transition: never use transition-all",
      "Prefer 120–180ms for hover, 180–240ms for drawers/dialogs",
      "Use subtle color/outline/shadow changes; avoid bouncy motion in ERP"
    ],
    "tailwind_examples": {
      "button": "transition-colors duration-150",
      "card_hover": "transition-shadow duration-150 hover:shadow-[var(--shadow-2)]",
      "focus": "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] focus-visible:ring-offset-2"
    },
    "loading_states": [
      "Use Skeleton rows for tables",
      "Use Progress for long-running imports",
      "Use Sonner toast for background completion"
    ]
  },

  "accessibility": {
    "requirements": [
      "WCAG AA contrast for text on brand colors",
      "Visible focus ring on all interactive elements",
      "Keyboard: Cmd+K search, Esc closes dialogs/drawers",
      "Tables: ensure header cells use <th> semantics via shadcn Table",
      "Do not rely on color alone for status: pair Badge color with label"
    ]
  },

  "mobile_/mobile": {
    "principles": [
      "Large touch targets (min h-11)",
      "One task per screen",
      "Bottom navigation for 4–5 primary areas (Home, Tasks, Scan/Upload, Approvals, Profile)",
      "Filters in Drawer; tables become card lists with key fields"
    ],
    "patterns": {
      "list_item": "Card with 2-line title + 2 metadata chips + right-aligned amount/date",
      "primary_action": "Sticky bottom CTA bar (solid background)"
    }
  },

  "image_urls": {
    "launchpad_hero_optional": [
      {
        "url": "https://images.pexels.com/photos/8960944/pexels-photo-8960944.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "category": "launchpad",
        "description": "Optional banner image for Company Launchpad (engineering + tablet). Use as small right-side illustration only; keep <20% viewport."
      },
      {
        "url": "https://images.pexels.com/photos/8961001/pexels-photo-8961001.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "category": "launchpad",
        "description": "Optional banner image alternative; crop to wide and keep subtle."
      }
    ]
  },

  "instructions_to_main_agent": [
    "Remove default CRA centered header styles in App.css; do not center the app container.",
    "Implement runtime company theming by setting --brand-primary/--brand-surface/--brand-accent on :root or a [data-company] wrapper.",
    "Update shadcn token mapping in index.css so --primary, --background, --card, --ring reference brand + neutral tokens.",
    "Build a reusable <AppShell /> with Sidebar + Topbar; keep module pages as children.",
    "Standardize listing pages: PageHeader + FilterBar + DataTable + RightDrawer for edit.",
    "Use shadcn Resizable for split-screen AI reader and WBS/Gantt.",
    "Use recharts for S-curve and budget vs actual; keep chart backgrounds solid and minimal.",
    "Ensure every Button/Input/Select/Checkbox/Row action and key info (totals, errors, statuses) has data-testid in kebab-case.",
    "Use Indian number formatting and DD-MM-YYYY everywhere; keep numeric columns monospace.",
    "For /mobile, implement bottom nav + card lists; avoid dense tables."
  ],

  "general_ui_ux_design_guidelines_appendix": "<General UI UX Design Guidelines>\n    - You must **not** apply universal transition. Eg: `transition: all`. This results in breaking transforms. Always add transitions for specific interactive elements like button, input excluding transforms\n    - You must **not** center align the app container, ie do not add `.App { text-align: center; }` in the css file. This disrupts the human natural reading flow of text\n   - NEVER: use AI assistant Emoji characters like`🤖🧠💭💡🔮🎯📚🎭🎬🎪🎉🎊🎁🎀🎂🍰🎈🎨🎰💰💵💳🏦💎🪙💸🤑📊📈📉💹🔢🏆🥇 etc for icons. Always use **FontAwesome cdn** or **lucid-react** library already installed in the package.json\n\n **GRADIENT RESTRICTION RULE**\nNEVER use dark/saturated gradient combos (e.g., purple/pink) on any UI element.  Prohibited gradients: blue-500 to purple 600, purple 500 to pink-500, green-500 to blue-500, red to pink etc\nNEVER use dark gradients for logo, testimonial, footer etc\nNEVER let gradients cover more than 20% of the viewport.\nNEVER apply gradients to text-heavy content or reading areas.\nNEVER use gradients on small UI elements (<100px width).\nNEVER stack multiple gradient layers in the same viewport.\n\n**ENFORCEMENT RULE:**\n    • Id gradient area exceeds 20% of viewport OR affects readability, **THEN** use solid colors\n\n**How and where to use:**\n   • Section backgrounds (not content backgrounds)\n   • Hero section header content. Eg: dark to light to dark color\n   • Decorative overlays and accent elements only\n   • Hero section with 2-3 mild color\n   • Gradients creation can be done for any angle say horizontal, vertical or diagonal\n\n- For AI chat, voice application, **do not use purple color. Use color like light green, ocean blue, peach orange etc**\n\n</Font Guidelines>\n\n- Every interaction needs micro-animations - hover states, transitions, parallax effects, and entrance animations. Static = dead. \n   \n- Use 2-3x more spacing than feels comfortable. Cramped designs look cheap.\n\n- Subtle grain textures, noise overlays, custom cursors, selection states, and loading animations: separates good from extraordinary.\n   \n- Before generating UI, infer the visual style from the problem statement (palette, contrast, mood, motion) and immediately instantiate it by setting global design tokens (primary, secondary/accent, background, foreground, ring, state colors), rather than relying on any library defaults. Don't make the background dark as a default step, always understand problem first and define colors accordingly\n    Eg: - if it implies playful/energetic, choose a colorful scheme\n           - if it implies monochrome/minimal, choose a black–white/neutral scheme\n\n**Component Reuse:**\n\t- Prioritize using pre-existing components from src/components/ui when applicable\n\t- Create new components that match the style and conventions of existing components when needed\n\t- Examine existing components to understand the project's component patterns before creating new ones\n\n**IMPORTANT**: Do not use HTML based component like dropdown, calendar, toast etc. You **MUST** always use `/app/frontend/src/components/ui/ ` only as a primary components as these are modern and stylish component\n\n**Best Practices:**\n\t- Use Shadcn/UI as the primary component library for consistency and accessibility\n\t- Import path: ./components/[component-name]\n\n**Export Conventions:**\n\t- Components MUST use named exports (export const ComponentName = ...)\n\t- Pages MUST use default exports (export default function PageName() {...})\n\n**Toasts:**\n  - Use `sonner` for toasts\"\n  - Sonner component are located in `/app/src/components/ui/sonner.tsx`\n\nUse 2–4 color gradients, subtle textures/noise overlays, or CSS-based noise to avoid flat visuals.\n</General UI UX Design Guidelines>"
}
