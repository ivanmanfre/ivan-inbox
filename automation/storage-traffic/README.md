# Storage traffic alerts

This observer reads aggregate Storage GET response bytes from the project's edge
logs, covering all Storage buckets and callers for `bjbvqvzbzczjbatgmccb`.
It records byte counts, request counts and unknown response sizes. It does not
store object paths, query strings, IP addresses, user agents or raw log events.

The first run collects the latest completed hour. Later runs collect aligned
15-minute intervals after a five-minute ingestion delay. Both SQL and API
parameters contain matching start/end timestamps. Daily and hourly totals come
from saved interval measurements. The normal schedule reads 96 intervals per
day, totaling 24 hours of log time. No query spans more than 15 minutes. An
attempt is durably recorded before HTTP; a failed or interrupted attempt becomes
a visible coverage gap and is not retried automatically.

Catch-up is limited to four intervals per run and a 24-hour lookback. The
observer allows at most 192 query attempts in any rolling 24 hours. That limits
monitoring activity, while application operations continue. State corruption,
missing response sizes, query failures and gaps generate their own alerts.
The monitor's state must be preserved when updating it.

This uses the existing Log Query allowance. Supabase rejected server-side
`max_bytes_to_read` settings in a controlled probe, so these are time-window and
request-count bounds, not a guaranteed byte-scan budget. Fixed timestamp filters
and saved aggregates avoid repeatedly scanning a full day. No paid Log Drain
add-on is enabled. The separate old Storage scanner remains disabled.

Warnings use Ivan's existing own-inbox `supabase-egress` source. The defaults are
1 GB observed in the hour and 8 GB observed in 24 hours. Partial coverage stays
visible in the message. Hour alerts have a three-hour cooldown; other conditions
have a 24-hour cooldown. A failed latest attempted interval has its own
three-hour warning cooldown, independent of old coverage gaps. Intervals awaiting
catch-up are counted in partial totals and are excluded from failed-gap alarms.
An accepted alert updates its own cooldown. Failures to
send remain retryable. These are response-header monitoring estimates, with
cached and uncached traffic included where present in edge logs. They are not
invoice totals. Very late ingestion and missing size headers can affect counts.
Warnings never pause preview jobs, alter application traffic or change billing.

## Existing server deployment

The service and timer run on Ivan's existing server, independently of the Mac.
The timer runs at minutes 05, 20, 35 and 50 UTC. systemd supplies the management
token and the own-inbox relay configuration through protected credentials.
The script uses Python 3.10 standard-library modules only.

Install the script at `/opt/ivan-storage-traffic/monitor.py`; the root-owned
credential files are `/etc/ivan-storage-traffic/management-token` and
`/etc/ivan-storage-traffic/relay-config`. The latter is a JSON object with `key`
and `number`. Never commit credential values. The dynamic service user writes
only its private systemd state directory at `/var/lib/ivan-storage-traffic`.

A missing or invalid relay credential prevents inbox delivery. Inspect
`systemctl status ivan-storage-traffic.service` for that failure. The service's
180-second limit can interrupt a slow request; its reserved interval remains a
visible gap on the next run.

Offline checks:

```sh
python3 -B automation/storage-traffic/test_monitor.py
```

Without `--collect` or `--notify`, the script evaluates saved measurements
without credentials or network calls. `--collect` reads new intervals;
`--notify` sends only actual eligible warnings. Deployment uses live aggregate
reads and historical alert replay without sending a fake notification.
