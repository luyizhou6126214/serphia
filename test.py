#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""薪人薪事开放平台 —— 薪酬数据拉取脚本（仅用标准库）

接口文档
    工资报表      POST /v5/payroll/report/list
    工资报表详情   POST /v5/payroll/report/detail/v2
    文档地址      https://s.xinrenxinshi.com/user-center/openapi/pages/1829055656854478850

鉴权方式
    1. 用 client_id / client_secret 换取 access_token（有效期 2 小时）
    2. 调业务接口时把 access_token 放在请求头
    3. sign = urlencode(base64(hmac_sha1(请求体 JSON 原文, client_secret)))
       —— 签名用的是「原样发送的那段 JSON 字符串」，所以只能序列化一次再复用

用法
    python test.py --probe                    # 先自检凭证与接口权限
    python test.py                          # 当月（无归档则自动回退上月）的「全数据」报表
    python test.py --yearmo 202610          # 指定月份 yyyyMM
    python test.py --yearmo 202610 --report 工资信息表
    python test.py --yearmo 202610 --all    # 该月全部报表
    python test.py --yearmo 202610 --all --max-rows 0   # 不限行数
    python test.py --yearmo 202610 --json out.json      # 另存原始 JSON
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Sequence


class ApiError(RuntimeError):
    """接口返回非 0 errcode，或 HTTP 层失败。"""

    def __init__(self, message: str, errcode: Any = None, payload: Any = None) -> None:
        super().__init__(message)
        self.errcode = errcode
        self.payload = payload


class XinrenxinshiPayroll:
    """薪人薪事薪酬（工资报表）接口客户端。"""

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        access_token: Optional[str] = None,
        base_url: str = "https://api.xinrenxinshi.com",
        timeout: int = 30,
    ) -> None:
        self.client_id = client_id
        self.client_secret = client_secret
        self.access_token = access_token
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._token_expire_at = 0.0

    # ------------------------------------------------------------------ 鉴权
    def get_access_token(self, force: bool = False) -> str:
        """获取（或复用）access_token。提前 60 秒刷新，避免临界点失败。"""
        if (
            not force
            and self.access_token
            and (self._token_expire_at == 0.0 or time.time() < self._token_expire_at - 60)
        ):
            return self.access_token

        query = urllib.parse.urlencode(
            {
                "grant_type": "client_credentials",
                "client_secret": self.client_secret,
                "client_id": self.client_id,
            }
        )
        url = f"{self.base_url}/authorize/oauth/token?{query}"
        req = urllib.request.Request(url, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")
            raise ApiError(f"获取 access_token 失败：HTTP {exc.code} {detail}", exc.code) from exc
        except urllib.error.URLError as exc:
            raise ApiError(f"获取 access_token 失败：{exc.reason}") from exc

        data = json.loads(body)
        token = data.get("access_token")
        if not token:
            raise ApiError(f"获取 access_token 失败：{body}", data.get("error"), data)

        self.access_token = token
        self._token_expire_at = time.time() + int(data.get("expires_in") or 7200)
        return token

    # ------------------------------------------------------------------ 签名
    def _sign(self, body_text: str) -> str:
        """sign = urlencode(base64(hmac_sha1(body, client_secret)))，与发送体逐字节对应。"""
        digest = hmac.new(
            self.client_secret.encode("utf-8"), body_text.encode("utf-8"), hashlib.sha1
        ).digest()
        return urllib.parse.quote(base64.b64encode(digest).decode("ascii"), safe="")

    # ------------------------------------------------------------------ 请求
    def _post(self, path: str, payload: Dict[str, Any], retry_on_auth: bool = True) -> Dict[str, Any]:
        # 只序列化一次：签名和请求体必须是同一段字符串
        body_text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        url = f"{self.base_url}{path}?sign={self._sign(body_text)}"
        req = urllib.request.Request(
            url,
            data=body_text.encode("utf-8"),
            method="POST",
            headers={
                "access_token": self.get_access_token(),
                "Content-Type": "application/json;charset=UTF-8",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", "replace")
            if retry_on_auth and exc.code == 401:
                self.get_access_token(force=True)
                return self._post(path, payload, retry_on_auth=False)
            raise ApiError(f"HTTP {exc.code}：{raw}", exc.code) from exc
        except urllib.error.URLError as exc:
            raise ApiError(f"网络异常：{exc.reason}") from exc

        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ApiError(f"响应不是合法 JSON：{raw[:500]}") from exc

        # 网关对不存在的路径也会返回 code=0，只是 message 里说明“路径不存在”
        if data.get("errcode") in (0, None) and "data" not in data:
            message = str(data.get("message") or data.get("errmsg") or "")
            if "不存在" in message:
                raise ApiError(f"接口路径不存在：{path}（{message}）", -1, data)

        if data.get("errcode") not in (0, None):
            # 910004 = 不合法的 access_token 或已失效：刷新令牌后重试一次
            if retry_on_auth and data.get("errcode") in (401, 10001, 10002, 910004):
                self.get_access_token(force=True)
                return self._post(path, payload, retry_on_auth=False)
            raise ApiError(
                f"接口返回错误 errcode={data.get('errcode')} errmsg={data.get('errmsg')} "
                f"detailMsg={data.get('detailMsg')}",
                data.get("errcode"),
                data,
            )
        return data

    # ------------------------------------------------------------------ 业务
    def list_archives(self, yearmo: str) -> Dict[str, Any]:
        """工资报表：返回该年月份已归档的全部报表清单。"""
        resp = self._post(
            "/v5/payroll/report/list",
            {"yearmo": yearmo, "timestamp": int(time.time() * 1000)},
        )
        return resp.get("data") or {}

    def report_detail(
        self, report_id: str, sub_report_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """工资报表详情：reportHeadList + reportDetailList（按表头顺序排列的二维数组）。"""
        payload: Dict[str, Any] = {
            "reportId": report_id,
            "timestamp": int(time.time() * 1000),
        }
        if sub_report_id:
            payload["subReportId"] = sub_report_id
        resp = self._post("/v5/payroll/report/detail/v2", payload)
        return resp.get("data") or {}


# ---------------------------------------------------------------------- 输出
def _display_width(text: str) -> int:
    return sum(2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1 for ch in text)


def _clip(text: str, width: int) -> str:
    if _display_width(text) <= width:
        return text
    if width <= 1:
        return "…"[:width]
    out, used = [], 0
    for ch in text:
        w = 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1
        if used + w > width - 1:
            return "".join(out) + "…"
        out.append(ch)
        used += w
    return "".join(out)


def _pad(text: str, width: int) -> str:
    return text + " " * max(0, width - _display_width(text))


def print_table(headers: Sequence[str], rows: Iterable[Sequence[Any]], max_width: int = 22) -> None:
    headers = [str(h) for h in headers]
    table = [[("" if cell is None else str(cell)) for cell in row] for row in rows]
    cols = max([len(headers)] + [len(r) for r in table]) if (headers or table) else 0
    headers += [""] * (cols - len(headers))
    table = [r + [""] * (cols - len(r)) for r in table]

    widths = []
    for i in range(cols):
        longest = max([_display_width(headers[i])] + [_display_width(r[i]) for r in table])
        widths.append(min(max(longest, 4), max_width))

    line = "  ".join(_pad(_clip(headers[i], widths[i]), widths[i]) for i in range(cols)).rstrip()
    print(line)
    print("-" * _display_width(line))
    for row in table:
        print("  ".join(_pad(_clip(row[i], widths[i]), widths[i]) for i in range(cols)).rstrip())


def _month_candidates(yearmo: Optional[str]) -> List[str]:
    if yearmo:
        return [yearmo]
    now = datetime.now()
    this_month = now.strftime("%Y%m")
    previous = f"{now.year - 1}12" if now.month == 1 else f"{now.year}{now.month - 1:02d}"
    return [this_month, previous]


ERR_PERMISSION = 910002
PERMISSION_HINT = """\
[权限不足] errcode=910002：当前应用没有开通「薪酬 / 工资报表」接口权限。
  · 凭证本身是有效的（OAuth 换 token 正常、签名校验通过），只差接口授权；
  · 需要在薪人薪事开放平台为这个应用开通薪酬模块下这两个接口：
        工资报表       POST /v5/payroll/report/list
        工资报表详情   POST /v5/payroll/report/detail/v2
  · 开通后不用改脚本，直接重新执行即可。
  · 文档：https://s.xinrenxinshi.com/user-center/openapi/pages/1829055656854478850
"""


def probe(client: XinrenxinshiPayroll) -> int:
    """自检：凭证是否有效、薪酬接口是否已授权。"""
    print("1) 获取 access_token …")
    try:
        token = client.get_access_token(force=True)
    except ApiError as exc:
        print(f"   失败：{exc}")
        print("   → client_id / client_secret 有误，或网络不可达。")
        return 1
    print(f"   成功：{token[:8]}…（有效期约 2 小时）")

    print("2) 检查薪酬接口权限 …")
    ts = int(time.time() * 1000)
    checks = [
        ("工资报表", "/v5/payroll/report/list", {"yearmo": time.strftime("%Y%m"), "timestamp": ts}),
        ("工资报表详情", "/v5/payroll/report/detail/v2", {"reportId": "0000", "timestamp": ts}),
    ]
    all_ok = True
    for name, path, body in checks:
        try:
            client._post(path, body)
            print(f"   {name:<6} 已授权（{path}）")
        except ApiError as exc:
            if exc.errcode == ERR_PERMISSION:
                all_ok = False
                print(f"   {name:<6} 未授权（{path}）")
            else:
                print(f"   {name:<6} 已授权，业务层返回 errcode={exc.errcode}（{path}）")

    if not all_ok:
        print()
        print(PERMISSION_HINT)
        return 2
    print("\n自检通过，可以正常拉取薪酬数据。")
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="拉取薪人薪事薪酬（工资报表）数据")
    parser.add_argument("--yearmo", help="年月，格式 yyyyMM，如 202610（默认当月）")
    parser.add_argument("--report", help="按报表名称模糊匹配，如 全数据 / 工资信息表")
    parser.add_argument("--all", action="store_true", help="拉取该月全部报表")
    parser.add_argument("--max-rows", type=int, default=20, help="每张报表最多打印多少行，0 表示全部（默认 20）")
    parser.add_argument("--json", metavar="FILE", help="把原始返回保存为 JSON 文件")
    parser.add_argument("--probe", action="store_true", help="只做连通性/权限自检，不拉数据")
    args = parser.parse_args(argv)

    client = XinrenxinshiPayroll(
        client_id="appTlxx8KX6kGc4UUvq6vzZOT5MEdGql",
        client_secret="FI3ysas4RePEzqgJIywM",
        access_token="0a942f2c-2b7f-4998-b8a5-7f0ffdb6f0e4",
        base_url=os.environ.get("XRXS_BASE_URL", "https://api.xinrenxinshi.com"),
    )

    if args.probe:
        return probe(client)

    archives: Dict[str, Any] = {}
    used_month = ""
    permission_denied = False
    last_error: Optional[ApiError] = None
    for month in _month_candidates(args.yearmo):
        try:
            archives = client.list_archives(month)
        except ApiError as exc:
            last_error = exc
            if exc.errcode == ERR_PERMISSION:
                permission_denied = True
                break
            print(f"[警告] 查询 {month} 失败：{exc}", file=sys.stderr)
            continue
        if archives.get("archiveReportList"):
            used_month = month
            break
        print(f"[提示] {month} 没有已归档的工资报表，继续尝试更早月份…", file=sys.stderr)

    if not used_month:
        if permission_denied:
            print(PERMISSION_HINT, file=sys.stderr)
            return 2
        print(f"没有查到任何已归档的工资报表。{last_error or ''}", file=sys.stderr)
        return 1

    reports = archives.get("archiveReportList") or []
    print(
        f"归档月份：{archives.get('yearmo', used_month)}   "
        f"归档时间：{archives.get('archiveTime', '-')}   "
        f"报表数：{len(reports)}"
    )

    if args.report:
        selected = [r for r in reports if args.report in (r.get("reportName") or "")]
        if not selected:
            names = "、".join(r.get("reportName", "?") for r in reports)
            print(f"未找到名称包含「{args.report}」的报表。可选：{names}", file=sys.stderr)
            return 1
    elif args.all:
        selected = reports
    else:
        selected = [r for r in reports if r.get("reportName") == "全数据"] or reports[:1]

    raw_output: Dict[str, Any] = {"archives": archives, "details": {}}
    for item in selected:
        report_id = item.get("reportId")
        sub_report_id = item.get("subReportId") or None
        label = item.get("reportName") or report_id
        print(f"\n===== {label} =====")
        try:
            detail = client.report_detail(report_id, sub_report_id)
        except ApiError as exc:
            if exc.errcode == ERR_PERMISSION:
                print(PERMISSION_HINT, file=sys.stderr)
                return 2
            print(f"[失败] {label}：{exc}", file=sys.stderr)
            continue

        raw_output["details"][f"{label}|{report_id}|{sub_report_id or ''}"] = detail
        heads = detail.get("reportHeadList") or []
        rows = detail.get("reportDetailList") or []
        print(
            f"报表：{detail.get('reportName', label)}   记录数：{detail.get('totalRow', len(rows))}   "
            f"归档时间：{detail.get('archiveTime', '-')}"
        )
        if not rows:
            print("（无数据）")
            continue
        limit = len(rows) if args.max_rows <= 0 else min(args.max_rows, len(rows))
        print_table(heads, rows[:limit])
        if limit < len(rows):
            print(f"… 共 {len(rows)} 行，已省略 {len(rows) - limit} 行（用 --max-rows 0 查看全部）")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(raw_output, fh, ensure_ascii=False, indent=2)
        print(f"\n原始 JSON 已保存：{args.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
