package engine

import "net"

func getAllLocalIPs() []string {
	var ips []string
	
	interfaces, err := net.Interfaces()
	if err != nil {
		return []string{"localhost"}
	}
	
	for _, iface := range interfaces {
		// Skip loopback, down interfaces, and interfaces without a running carrier
		if iface.Flags&net.FlagLoopback != 0 || 
		   iface.Flags&net.FlagUp == 0 || 
		   iface.Flags&net.FlagRunning == 0 {
			continue
		}
		
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			
			// Skip loopback and IPv6 addresses
			if ip == nil || ip.IsLoopback() || ip.To4() == nil {
				continue
			}
			
			ips = append(ips, ip.String())
		}
	}
	
	if len(ips) == 0 {
		return []string{"localhost"}
	}
	
	return ips
}