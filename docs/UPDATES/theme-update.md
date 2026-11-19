Use the claude_design MCP (https://api.anthropic.com/v1/design/mcp, auth via /design-login) to import this project:
https://claude.ai/design/p/de9b78df-90e7-4214-a853-218a92aeb534?file=Keystone HR+Salon.dc.html

Focus on these files (the whole project is readable):
- `Keystone HR Salon.dc.html`

## Typography  & Color Scheme
- Strictly follow the theme in the `Keystone HR Salon.dc.html`, and update the colors, font and components accordingly.
- Use the same font-weight and font-size for the Table Header, Table Row contents in the design
- Use same font-weight,font-size,color for sidemenu items in the design
- Use same font-weight and font-size for the Table Header, Table Row contents in the design
- For the Input field components like textbox, label etc should use the same font color and font-size as in the design.
- For the table Actions column, use the Icons similar to provided in the design. If no Icons are designed for a particular module, use a matching Icon.
- All colors are defined as CSS custom properties in `globals.css` and mapped to Tailwind tokens via `@theme inline`. Components must use these tokens — no hardcoded hex values or raw Tailwind color classes like `zinc-*`.

## Collapsible Sidebar
- Implement collapsible sidebar menu similar to the design.

## Theme
- These change should be implemented in both Dark+Gold and Light+Gold and Green theme