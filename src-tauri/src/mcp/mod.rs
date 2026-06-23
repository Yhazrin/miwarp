//! Local MCP server implementations (v1.2.0)
//!
//! `mcp` is reserved for **MiWarp acting as MCP server** (server-side). The
//! existing `commands::mcp` module is **MCP client-side** (consuming external
//! MCP servers). They are intentionally in different namespaces to avoid
//! confusion.

pub mod fleet_server;
