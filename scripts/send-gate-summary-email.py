#!/usr/bin/env python3
"""
Send the production-readiness-gate summary to EMAIL_TO via SMTP.

Required env vars:
  EMAIL_SMTP_HOST  — SMTP server (default: smtp.gmail.com)
  EMAIL_SMTP_PORT  — SMTP port (default: 587, uses STARTTLS)
  EMAIL_SMTP_USER  — SMTP login / sender address
  EMAIL_SMTP_PASS  — SMTP password or Gmail App Password
  EMAIL_TO         — recipient address(es), comma-separated
  EMAIL_FROM       — sender display address (default: EMAIL_SMTP_USER)

Usage:
  SEND_SUMMARY_EMAIL=true EMAIL_SMTP_USER=you@gmail.com EMAIL_SMTP_PASS=xxxx \\
    EMAIL_TO=you@gmail.com python3 scripts/send-gate-summary-email.py \\
    reports/production-gate/<run>/production-readiness-summary.md

Gmail setup: enable 2FA, create an App Password at
  https://myaccount.google.com/apppasswords
and use it as EMAIL_SMTP_PASS.
"""

import os
import re
import smtplib
import ssl
import sys
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path


# ---------------------------------------------------------------------------
# Minimal markdown → HTML converter for our specific summary format
# ---------------------------------------------------------------------------

def _inline(text: str) -> str:
    text = re.sub(r"\[([^\]]*)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"`([^`]+)`", r'<code style="background:#f6f8fa;padding:2px 5px;border-radius:3px;font-size:0.9em">\1</code>', text)
    return text


def _cell_html(raw: str, tag: str) -> str:
    content = _inline(raw.strip())
    if content == "PASS":
        content = '<span style="color:#22863a;font-weight:bold">PASS</span>'
    elif content == "FAIL":
        content = '<span style="color:#cb2431;font-weight:bold">FAIL</span>'
    style = 'style="border:1px solid #d0d7de;padding:6px 12px;text-align:left"'
    return f"<{tag} {style}>{content}</{tag}>"


def md_to_html(md: str) -> str:
    lines = md.splitlines()
    out: list[str] = []
    in_table = False
    table_head_done = False
    in_code = False

    def close_table():
        nonlocal in_table, table_head_done
        if in_table:
            if not table_head_done:
                out.append("</thead>")
            out.append("</tbody></table>")
            in_table = False
            table_head_done = False

    for line in lines:
        # Fenced code blocks
        if line.startswith("```"):
            if in_code:
                out.append("</code></pre>")
                in_code = False
            else:
                close_table()
                out.append('<pre style="background:#f6f8fa;padding:12px;border-radius:6px;overflow-x:auto"><code>')
                in_code = True
            continue
        if in_code:
            out.append(line.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
            continue

        # Headings
        if line.startswith("# "):
            close_table()
            out.append(f'<h1 style="border-bottom:2px solid #e1e4e8;padding-bottom:8px">{_inline(line[2:])}</h1>')
        elif line.startswith("## "):
            close_table()
            out.append(f'<h2 style="border-bottom:1px solid #e1e4e8;padding-bottom:6px;margin-top:24px">{_inline(line[3:])}</h2>')
        elif line.startswith("### "):
            close_table()
            out.append(f'<h3 style="margin-top:16px">{_inline(line[4:])}</h3>')
        # Tables
        elif line.startswith("|"):
            cells = [c for c in line.split("|")][1:-1]
            # Separator row (---)
            if all(re.match(r"^\s*-+\s*$", c) for c in cells):
                out.append("</tr></thead><tbody>")
                table_head_done = True
            else:
                if not in_table:
                    out.append('<table style="border-collapse:collapse;width:100%;margin:8px 0">')
                    out.append("<thead><tr>")
                    in_table = True
                    table_head_done = False
                    tag = "th"
                else:
                    tag = "td" if table_head_done else "th"
                    if tag == "td":
                        out.append("<tr>")
                out.extend(_cell_html(c, tag) for c in cells)
                if tag == "td":
                    out.append("</tr>")
        # Blockquote
        elif line.startswith("> "):
            close_table()
            out.append(f'<blockquote style="border-left:4px solid #e1e4e8;margin:8px 0;padding:4px 16px;color:#57606a">{_inline(line[2:])}</blockquote>')
        # List item
        elif line.startswith("- "):
            close_table()
            out.append(f'<li style="margin:3px 0">{_inline(line[2:])}</li>')
        # Blank line
        elif not line.strip():
            close_table()
            out.append("<br>")
        else:
            close_table()
            out.append(f'<p style="margin:4px 0">{_inline(line)}</p>')

    close_table()

    body = "\n".join(out)
    return f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
             max-width:960px;margin:0 auto;padding:24px;color:#24292f;font-size:14px;line-height:1.5">
{body}
<hr style="border:none;border-top:1px solid #e1e4e8;margin-top:32px">
<p style="color:#57606a;font-size:12px">Generated by DACN production-readiness-gate</p>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Email sending
# ---------------------------------------------------------------------------

def _extract_field(md: str, keyword: str) -> str:
    for line in md.splitlines():
        if keyword in line:
            return line.split(":")[-1].strip().strip("*").strip()
    return ""


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <summary-markdown-file>", file=sys.stderr)
        sys.exit(1)

    summary_path = Path(sys.argv[1])
    if not summary_path.exists():
        print(f"File not found: {summary_path}", file=sys.stderr)
        sys.exit(1)

    smtp_host = os.environ.get("EMAIL_SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.environ.get("EMAIL_SMTP_PORT", "587"))
    smtp_user = os.environ.get("EMAIL_SMTP_USER", "")
    smtp_pass = os.environ.get("EMAIL_SMTP_PASS", "")
    email_to  = os.environ.get("EMAIL_TO", "")
    email_from = os.environ.get("EMAIL_FROM", smtp_user)

    missing = [v for v, k in [
        (smtp_user, "EMAIL_SMTP_USER"),
        (smtp_pass, "EMAIL_SMTP_PASS"),
        (email_to,  "EMAIL_TO"),
    ] if not v]
    if missing:
        print(f"Missing env vars: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    md_content = summary_path.read_text()

    run_id   = _extract_field(md_content, "Test run ID")
    decision = "UNKNOWN"
    for line in md_content.splitlines():
        stripped = line.strip()
        if stripped.startswith("PASS."):
            decision = "PASS"
            break
        if stripped.startswith("FAIL."):
            decision = "FAIL"
            break

    subject = f"[DACN Gate] {decision} | {run_id}"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = email_from
    msg["To"]      = email_to

    msg.attach(MIMEText(md_content, "plain", "utf-8"))
    msg.attach(MIMEText(md_to_html(md_content), "html", "utf-8"))

    context = ssl.create_default_context()
    recipients = [addr.strip() for addr in email_to.split(",")]

    with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as server:
        server.ehlo()
        server.starttls(context=context)
        server.login(smtp_user, smtp_pass)
        server.sendmail(email_from, recipients, msg.as_string())

    print(f"Email sent → {email_to}: {subject}")


if __name__ == "__main__":
    main()
