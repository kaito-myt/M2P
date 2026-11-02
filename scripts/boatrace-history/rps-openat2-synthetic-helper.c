#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <linux/openat2.h>
#include <openssl/evp.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

#if !defined(__linux__) || !defined(SYS_openat2)
#error "This synthetic helper requires Linux openat2; unsupported platforms must fail closed."
#endif

static void fail(const char *code) {
  fprintf(stderr, "%s\n", code);
  exit(2);
}

static uint64_t parse_u64(const char *value) {
  if (!value || value[0] == '-' || value[0] == '+') fail("INVALID_LIMIT");
  char *end = NULL;
  errno = 0;
  unsigned long long parsed = strtoull(value, &end, 10);
  if (errno || end == value || *end != '\0') fail("INVALID_LIMIT");
  return (uint64_t) parsed;
}

static bool valid_relative_path(const char *path) {
  if (!path || path[0] == '\0' || path[0] == '/' || strlen(path) > 4096) return false;
  const char *component = path;
  for (const char *cursor = path;; cursor++) {
    if (*cursor == '\\') return false;
    if (*cursor == '/' || *cursor == '\0') {
      size_t length = (size_t)(cursor - component);
      if (length == 0 || (length == 1 && component[0] == '.')
          || (length == 2 && component[0] == '.' && component[1] == '.')) return false;
      if (*cursor == '\0') break;
      component = cursor + 1;
    }
  }
  return true;
}

static uint64_t monotonic_ms(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) fail("CLOCK_UNAVAILABLE");
  return (uint64_t)now.tv_sec * 1000 + (uint64_t)now.tv_nsec / 1000000;
}

static bool same_file_snapshot(const struct stat *left, const struct stat *right) {
  return left->st_dev == right->st_dev && left->st_ino == right->st_ino
      && left->st_size == right->st_size && left->st_mtim.tv_sec == right->st_mtim.tv_sec
      && left->st_mtim.tv_nsec == right->st_mtim.tv_nsec
      && left->st_ctim.tv_sec == right->st_ctim.tv_sec
      && left->st_ctim.tv_nsec == right->st_ctim.tv_nsec;
}

int main(int argc, char **argv) {
  if ((argc != 18 && argc != 20) || strcmp(argv[1], "--synthetic-fixture") != 0) fail("SYNTHETIC_MODE_REQUIRED");
  const char *root_path = NULL, *expected_dev_arg = NULL, *expected_ino_arg = NULL, *expected_uid_arg = NULL;
  const char *relative_path = NULL, *max_bytes_arg = NULL, *max_wall_arg = NULL, *max_address_arg = NULL;
  bool test_blocking_open = false;
  for (int i = 2; i < argc; i += 2) {
    if (i + 1 >= argc) fail("INVALID_ARGUMENTS");
    if (strcmp(argv[i], "--root") == 0 && !root_path) root_path = argv[i + 1];
    else if (strcmp(argv[i], "--expected-dev") == 0 && !expected_dev_arg) expected_dev_arg = argv[i + 1];
    else if (strcmp(argv[i], "--expected-ino") == 0 && !expected_ino_arg) expected_ino_arg = argv[i + 1];
    else if (strcmp(argv[i], "--expected-uid") == 0 && !expected_uid_arg) expected_uid_arg = argv[i + 1];
    else if (strcmp(argv[i], "--relative-path") == 0 && !relative_path) relative_path = argv[i + 1];
    else if (strcmp(argv[i], "--max-bytes") == 0 && !max_bytes_arg) max_bytes_arg = argv[i + 1];
    else if (strcmp(argv[i], "--max-wall-ms") == 0 && !max_wall_arg) max_wall_arg = argv[i + 1];
    else if (strcmp(argv[i], "--max-address-bytes") == 0 && !max_address_arg) max_address_arg = argv[i + 1];
    else if (strcmp(argv[i], "--synthetic-test-blocking-open") == 0 && !test_blocking_open
        && strcmp(argv[i + 1], "1") == 0) test_blocking_open = true;
    else fail("INVALID_ARGUMENTS");
  }
  if (!root_path || !expected_dev_arg || !expected_ino_arg || !expected_uid_arg || !relative_path
      || !max_bytes_arg || !max_wall_arg || !max_address_arg) fail("INVALID_ARGUMENTS");
  if (root_path[0] != '/' || !valid_relative_path(relative_path)) fail("PATH_OR_TYPE");

  uint64_t expected_dev = parse_u64(expected_dev_arg);
  uint64_t expected_ino = parse_u64(expected_ino_arg);
  uint64_t expected_uid = parse_u64(expected_uid_arg);
  uint64_t max_bytes = parse_u64(max_bytes_arg);
  uint64_t max_wall_ms = parse_u64(max_wall_arg);
  uint64_t max_address_bytes = parse_u64(max_address_arg);
  if (max_bytes == 0 || max_wall_ms == 0 || max_address_bytes == 0
      || max_address_bytes > (uint64_t)RLIM_INFINITY || max_wall_ms > UINT32_MAX) fail("INVALID_LIMIT");
  struct itimerval deadline = {
    .it_value = {.tv_sec = (time_t)(max_wall_ms / 1000), .tv_usec = (suseconds_t)((max_wall_ms % 1000) * 1000)},
  };
  if (setitimer(ITIMER_REAL, &deadline, NULL) != 0) fail("HARD_TIMEOUT_UNAVAILABLE");
  struct rlimit address_limit = {(rlim_t)max_address_bytes, (rlim_t)max_address_bytes};
  if (setrlimit(RLIMIT_AS, &address_limit) != 0) fail("RESOURCE_LIMIT_UNAVAILABLE");

  int root_fd = open(root_path, O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root_fd < 0) fail("ROOT_OPEN_FAILED");
  struct stat root_stat;
  if (fstat(root_fd, &root_stat) != 0 || !S_ISDIR(root_stat.st_mode)
      || (uint64_t)root_stat.st_dev != expected_dev || (uint64_t)root_stat.st_ino != expected_ino) {
    close(root_fd);
    fail("ROOT_IDENTITY_MISMATCH");
  }

  struct open_how how = {
    .flags = O_RDONLY | O_CLOEXEC | O_NOFOLLOW | (test_blocking_open ? 0 : O_NONBLOCK),
    .resolve = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS,
  };
  int file_fd = (int)syscall(SYS_openat2, root_fd, relative_path, &how, sizeof(how));
  close(root_fd);
  if (file_fd < 0) fail(errno == ENOSYS ? "OPENAT2_UNAVAILABLE" : "PATH_OR_TYPE");

  struct stat before, after;
  if (fstat(file_fd, &before) != 0 || !S_ISREG(before.st_mode) || (uint64_t)before.st_uid != expected_uid || before.st_size < 0
      || (uint64_t)before.st_size > max_bytes) {
    close(file_fd);
    fail("PATH_OR_TYPE");
  }

  EVP_MD_CTX *digest = EVP_MD_CTX_new();
  if (!digest || EVP_DigestInit_ex(digest, EVP_sha256(), NULL) != 1) {
    if (digest) EVP_MD_CTX_free(digest);
    close(file_fd);
    fail("DIGEST_UNAVAILABLE");
  }
  const uint64_t started = monotonic_ms();
  uint64_t bytes = 0;
  unsigned char chunk[65536];
  for (;;) {
    if (monotonic_ms() - started >= max_wall_ms) {
      EVP_MD_CTX_free(digest); close(file_fd); fail("RESOURCE_ABORT");
    }
    ssize_t count = read(file_fd, chunk, sizeof(chunk));
    if (count < 0 && errno == EINTR) continue;
    if (count < 0) { EVP_MD_CTX_free(digest); close(file_fd); fail("READ_FAILED"); }
    if (count == 0) break;
    if ((uint64_t)count > max_bytes - bytes) {
      EVP_MD_CTX_free(digest); close(file_fd); fail("RESOURCE_ABORT");
    }
    if (EVP_DigestUpdate(digest, chunk, (size_t)count) != 1) {
      EVP_MD_CTX_free(digest); close(file_fd); fail("DIGEST_FAILED");
    }
    bytes += (uint64_t)count;
  }
  if (fstat(file_fd, &after) != 0 || !same_file_snapshot(&before, &after) || bytes != (uint64_t)before.st_size) {
    EVP_MD_CTX_free(digest); close(file_fd); fail("MUTATED_DURING_READ");
  }
  close(file_fd);

  unsigned char hash[EVP_MAX_MD_SIZE];
  unsigned int hash_size = 0;
  if (EVP_DigestFinal_ex(digest, hash, &hash_size) != 1 || hash_size != 32) {
    EVP_MD_CTX_free(digest); fail("DIGEST_FAILED");
  }
  EVP_MD_CTX_free(digest);
  printf("{\"mode\":\"SYNTHETIC_ONLY\",\"bytes\":\"%" PRIu64 "\",\"sha256\":\"", bytes);
  for (unsigned int i = 0; i < hash_size; i++) printf("%02x", hash[i]);
  printf("\"}\n");
  return 0;
}
