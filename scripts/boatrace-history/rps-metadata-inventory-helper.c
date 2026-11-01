#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <linux/openat2.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#if !defined(__linux__) || !defined(SYS_openat2)
#error "Synthetic metadata inventory requires Linux openat2."
#endif

static void fail(const char *code) { fprintf(stderr, "%s\n", code); exit(2); }

static char work_dir[] = "/tmp/rps-metadata-inventory-XXXXXX";
static char root_dir[sizeof(work_dir) + 16];
static const char *cleanup_files[425];
static size_t cleanup_count;

static void cleanup_fixture(void) {
  if (root_dir[0]) {
    for (size_t i = 0; i < cleanup_count; i++) {
      char file_path[sizeof(root_dir) + 80];
      snprintf(file_path, sizeof(file_path), "%s/%s", root_dir, cleanup_files[i]);
      unlink(file_path);
    }
    rmdir(root_dir);
  }
  if (work_dir[0]) rmdir(work_dir);
}

static uint64_t parse_u64(const char *text) {
  if (!text || !*text || *text == '-' || *text == '+') fail("INVALID_ARGUMENTS");
  char *end = NULL;
  errno = 0;
  unsigned long long value = strtoull(text, &end, 10);
  if (errno || end == text || *end) fail("INVALID_ARGUMENTS");
  return (uint64_t)value;
}

static bool valid_basename(const char *name) {
  if (!name || strchr(name, '/') || strchr(name, '\\') || strlen(name) > 64) return false;
  if (strcmp(name, "source-manifest.json") == 0 || strcmp(name, "source-receipt.json") == 0
      || strcmp(name, "original-part-provenance.json") == 0) return true;
  bool raw = strlen(name) == 23 && strcmp(name + 14, "-raw.json") == 0;
  bool manifest = strlen(name) == 28 && strcmp(name + 14, "-manifest.json") == 0;
  if ((!raw && !manifest) || strncmp(name, "day-", 4) || name[8] != '-' || name[11] != '-') return false;
  for (int i = 4; i <= 13; i++) if (i != 8 && i != 11 && (name[i] < '0' || name[i] > '9')) return false;
  return true;
}

static uint64_t mount_id_for_fd(int fd) {
  char path[64];
  snprintf(path, sizeof(path), "/proc/self/fdinfo/%d", fd);
  FILE *info = fopen(path, "re");
  if (!info) fail("MOUNT_ID_UNAVAILABLE");
  char *line = NULL;
  size_t capacity = 0;
  uint64_t result = 0;
  while (getline(&line, &capacity, info) >= 0) {
    if (strncmp(line, "mnt_id:", 7) == 0) {
      char *value = line + 7;
      while (*value == ' ' || *value == '\t') value++;
      char *end = value + strlen(value);
      while (end > value && (end[-1] == '\n' || end[-1] == '\r' || end[-1] == ' ' || end[-1] == '\t')) *--end = '\0';
      result = parse_u64(value);
      break;
    }
  }
  free(line);
  fclose(info);
  if (!result) fail("MOUNT_ID_UNAVAILABLE");
  return result;
}

static void print_ns(int64_t seconds, long nanoseconds) {
  __int128 value = (__int128)seconds * 1000000000 + nanoseconds;
  if (value < 0 || value > INT64_MAX) fail("TIMESTAMP_RANGE");
  printf("%" PRId64, (int64_t)value);
}

int main(int argc, char **argv) {
  const char *expected_uid_arg = NULL;
  uint64_t max_file = 0, max_total = 0;
  const char *files[425];
  size_t file_count = 0;
  bool synthetic_flag = false;
  for (int i = 1; i < argc;) {
    if (i + 1 >= argc) fail("INVALID_ARGUMENTS");
    const char *key = argv[i], *value = argv[i + 1];
    if (strcmp(key, "--synthetic-fixture") == 0 && strcmp(value, "1") == 0 && !synthetic_flag) { synthetic_flag = true; i += 2; continue; }
    if (strcmp(key, "--expected-uid") == 0 && !expected_uid_arg) expected_uid_arg = value;
    else if (strcmp(key, "--max-file-bytes") == 0 && !max_file) max_file = parse_u64(value);
    else if (strcmp(key, "--max-total-bytes") == 0 && !max_total) max_total = parse_u64(value);
    else if (strcmp(key, "--file") == 0 && file_count < 425 && valid_basename(value)) files[file_count++] = value;
    else fail("INVALID_ARGUMENTS");
    i += 2;
  }
  if (!synthetic_flag || !expected_uid_arg || !max_file || !max_total || file_count != 425) fail("SYNTHETIC_MODE_REQUIRED");
  uint64_t expected_uid = parse_u64(expected_uid_arg);

  if (!mkdtemp(work_dir)) fail("SYNTHETIC_FIXTURE_CREATE_FAILED");
  atexit(cleanup_fixture);
  snprintf(root_dir, sizeof(root_dir), "%s/fixture-root", work_dir);
  if (mkdir(root_dir, 0700) != 0) fail("SYNTHETIC_FIXTURE_CREATE_FAILED");
  int create_fd = open(root_dir, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (create_fd < 0) fail("SYNTHETIC_FIXTURE_CREATE_FAILED");
  const char sentinel[] = "synthetic-content-must-not-be-opened";
  for (size_t index = 0; index < file_count; index++) {
    int created = openat(create_fd, files[index], O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (created < 0) { close(create_fd); fail("SYNTHETIC_FIXTURE_CREATE_FAILED"); }
    ssize_t written = write(created, sentinel, sizeof(sentinel) - 1);
    if (written != (ssize_t)(sizeof(sentinel) - 1) || close(created) != 0) { close(create_fd); fail("SYNTHETIC_FIXTURE_CREATE_FAILED"); }
    cleanup_files[cleanup_count++] = files[index];
  }
  close(create_fd);
  int root_fd = open(root_dir, O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root_fd < 0) fail("ROOT_OPEN_FAILED");
  struct stat root_stat;
  if (fstat(root_fd, &root_stat) != 0 || !S_ISDIR(root_stat.st_mode) || (uint64_t)root_stat.st_uid != expected_uid) fail("ROOT_IDENTITY_MISMATCH");
  uint64_t root_mount_id = mount_id_for_fd(root_fd);
  printf("{\"mode\":\"SYNTHETIC_ONLY\",\"rootIdentity\":{\"dev\":\"%" PRIu64 "\",\"ino\":\"%" PRIu64 "\",\"mountId\":\"%" PRIu64 "\"},\"rows\":[", (uint64_t)root_stat.st_dev, (uint64_t)root_stat.st_ino, root_mount_id);
  uint64_t total = 0;
  for (size_t index = 0; index < file_count; index++) {
    struct open_how how = {.flags = O_PATH | O_CLOEXEC, .resolve = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS};
    int fd = (int)syscall(SYS_openat2, root_fd, files[index], &how, sizeof(how));
    if (fd < 0) fail(errno == ENOSYS ? "OPENAT2_UNAVAILABLE" : "FIXTURE_ENTRY_UNAVAILABLE");
    struct stat metadata;
    if (fstat(fd, &metadata) != 0 || !S_ISREG(metadata.st_mode) || metadata.st_size < 0
        || (uint64_t)metadata.st_uid != expected_uid || metadata.st_nlink != 1
        || (uint64_t)metadata.st_dev != (uint64_t)root_stat.st_dev || (uint64_t)metadata.st_size > max_file) {
      close(fd); fail("METADATA_POLICY_REJECTED");
    }
    uint64_t file_mount_id = mount_id_for_fd(fd);
    if (file_mount_id != root_mount_id) { close(fd); fail("MOUNT_BOUNDARY_MISMATCH"); }
    if ((uint64_t)metadata.st_size > max_total - total) { close(fd); fail("TOTAL_SIZE_LIMIT_EXCEEDED"); }
    total += (uint64_t)metadata.st_size;
    if (index) printf(",");
    printf("{\"basename\":\"%s\",\"kind\":\"%s\",\"bytes\":%" PRIu64 ",\"dev\":\"%" PRIu64 "\",\"ino\":\"%" PRIu64 "\",\"mountId\":\"%" PRIu64 "\",\"nlink\":%" PRIu64 ",\"uid\":%" PRIu64 ",\"mtimeNs\":\"", files[index],
      strstr(files[index], "-raw.json") ? "raw" : strstr(files[index], "-manifest.json") && strncmp(files[index], "day-", 4) == 0 ? "day_manifest" : strcmp(files[index], "source-manifest.json") == 0 ? "source_manifest" : strcmp(files[index], "source-receipt.json") == 0 ? "source_receipt" : "provenance",
      (uint64_t)metadata.st_size, (uint64_t)metadata.st_dev, (uint64_t)metadata.st_ino, file_mount_id, (uint64_t)metadata.st_nlink, (uint64_t)metadata.st_uid);
    print_ns(metadata.st_mtim.tv_sec, metadata.st_mtim.tv_nsec);
    printf("\",\"ctimeNs\":\"");
    print_ns(metadata.st_ctim.tv_sec, metadata.st_ctim.tv_nsec);
    printf("\"");
    if (strncmp(files[index], "day-", 4) == 0) printf(",\"date\":\"%.10s\"", files[index] + 4);
    printf("}");
    close(fd);
  }
  close(root_fd);
  printf("]}\n");
  return 0;
}
