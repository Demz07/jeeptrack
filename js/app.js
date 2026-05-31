document.addEventListener("DOMContentLoaded", () => {
  const role = localStorage.getItem("jeeptrack_role");
  if (role === "driver" && !window.location.pathname.includes("driver.html")) {
    window.location.href = "driver.html";
    return;
  }
  if (role === "passenger" && !window.location.pathname.includes("passenger.html")) {
    window.location.href = "passenger.html";
    return;
  }

  const driverBtn = document.getElementById("btn-driver");
  const passengerBtn = document.getElementById("btn-passenger");

  if (driverBtn) {
    driverBtn.addEventListener("click", () => {
      localStorage.setItem("jeeptrack_role", "driver");
      window.location.href = "driver.html";
    });
  }

  if (passengerBtn) {
    passengerBtn.addEventListener("click", () => {
      localStorage.setItem("jeeptrack_role", "passenger");
      window.location.href = "passenger.html";
    });
  }
});
