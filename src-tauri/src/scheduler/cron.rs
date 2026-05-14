use chrono::{DateTime, Datelike, Duration, Timelike, Utc};

/// Parse a 5-field cron expression and return the next fire time after `after`.
/// Fields: minute hour day-of-month month day-of-week
/// Supports: *, N, N-M, N/M, N,M
pub fn next_cron_time(expr: &str, after: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let fields: Vec<&str> = expr.trim().split_whitespace().collect();
    if fields.len() != 5 {
        return None;
    }

    let minutes = parse_field(fields[0], 0, 59)?;
    let hours = parse_field(fields[1], 0, 23)?;
    let days = parse_field(fields[2], 1, 31)?;
    let months = parse_field(fields[3], 1, 12)?;
    let weekdays = parse_field(fields[4], 0, 6)?;

    // Start from the next minute
    let mut t = after + Duration::minutes(1);
    t = t
        .with_second(0)
        .unwrap_or(t)
        .with_nanosecond(0)
        .unwrap_or(t);

    // Search up to 2 years ahead to avoid infinite loops
    let limit = after + Duration::days(365 * 2);

    while t < limit {
        if minutes.contains(&t.minute())
            && hours.contains(&t.hour())
            && days.contains(&(t.day() as u32))
            && months.contains(&(t.month() as u32))
            && weekdays.contains(&(t.weekday().num_days_from_sunday()))
        {
            return Some(t);
        }
        t = t + Duration::minutes(1);
    }

    None
}

/// Validate a 5-field cron expression.
pub fn validate_cron(expr: &str) -> bool {
    let fields: Vec<&str> = expr.trim().split_whitespace().collect();
    if fields.len() != 5 {
        return false;
    }
    let ranges = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 6)];
    fields
        .iter()
        .zip(ranges.iter())
        .all(|(f, &(min, max))| parse_field(f, min, max).is_some())
}

/// Generate a human-readable description of a cron expression.
pub fn describe_cron(expr: &str) -> String {
    let fields: Vec<&str> = expr.trim().split_whitespace().collect();
    if fields.len() != 5 {
        return format!("Invalid: {}", expr);
    }

    let (minute, hour, day, month, weekday) =
        (fields[0], fields[1], fields[2], fields[3], fields[4]);

    if expr == "* * * * *" {
        return "Every minute".into();
    }
    if minute.starts_with("*/") {
        return format!("Every {} minutes", &minute[2..]);
    }
    if hour.starts_with("*/") {
        return format!("Every {} hours", &hour[2..]);
    }

    if minute != "*" && hour != "*" {
        let h: u32 = hour.parse().unwrap_or(0);
        let m: u32 = minute.parse().unwrap_or(0);
        let period = if h >= 12 { "PM" } else { "AM" };
        let display_h = if h > 12 {
            h - 12
        } else if h == 0 {
            12
        } else {
            h
        };
        let display_m = format!("{:02}", m);

        if weekday != "*" {
            let day_names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
            let day_list: Vec<&str> = weekday
                .split(',')
                .filter_map(|d| {
                    d.parse::<usize>()
                        .ok()
                        .and_then(|i| day_names.get(i).copied())
                })
                .collect();
            return format!(
                "Every {} at {}:{} {}",
                day_list.join(", "),
                display_h,
                display_m,
                period
            );
        }
        if day == "*" && month == "*" {
            return format!("Every day at {}:{} {}", display_h, display_m, period);
        }
        return format!("At {}:{} {}", display_h, display_m, period);
    }

    format!("Schedule: {}", expr)
}

/// Parse a single cron field into a set of valid values.
fn parse_field(field: &str, min: u32, max: u32) -> Option<Vec<u32>> {
    let mut values = Vec::new();

    for part in field.split(',') {
        if part == "*" {
            for v in min..=max {
                values.push(v);
            }
            continue;
        }

        // Handle step: */N or range/step: N-M/S
        if let Some((range, step_str)) = part.split_once('/') {
            let step: u32 = step_str.parse().ok()?;
            if step == 0 {
                return None;
            }
            let (r_min, r_max) = if range == "*" {
                (min, max)
            } else if let Some((a, b)) = range.split_once('-') {
                (a.parse().ok()?, b.parse().ok()?)
            } else {
                let v: u32 = range.parse().ok()?;
                (v, v)
            };
            let mut v = r_min;
            while v <= r_max {
                values.push(v);
                v += step;
            }
            continue;
        }

        // Handle range: N-M
        if let Some((a, b)) = part.split_once('-') {
            let start: u32 = a.parse().ok()?;
            let end: u32 = b.parse().ok()?;
            for v in start..=end {
                values.push(v);
            }
            continue;
        }

        // Single value
        let v: u32 = part.parse().ok()?;
        if v < min || v > max {
            return None;
        }
        values.push(v);
    }

    values.sort();
    values.dedup();
    Some(values)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn test_every_minute() {
        let after = Utc.with_ymd_and_hms(2025, 1, 1, 12, 0, 0).unwrap();
        let next = next_cron_time("* * * * *", after).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2025, 1, 1, 12, 1, 0).unwrap());
    }

    #[test]
    fn test_specific_time() {
        let after = Utc.with_ymd_and_hms(2025, 1, 1, 8, 0, 0).unwrap();
        let next = next_cron_time("0 9 * * *", after).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2025, 1, 1, 9, 0, 0).unwrap());
    }

    #[test]
    fn test_step() {
        let after = Utc.with_ymd_and_hms(2025, 1, 1, 12, 0, 0).unwrap();
        let next = next_cron_time("*/15 * * * *", after).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2025, 1, 1, 12, 15, 0).unwrap());
    }

    #[test]
    fn test_validate() {
        assert!(validate_cron("0 9 * * 1-5"));
        assert!(validate_cron("*/5 * * * *"));
        assert!(!validate_cron("invalid"));
        assert!(!validate_cron("60 * * * *"));
    }
}
